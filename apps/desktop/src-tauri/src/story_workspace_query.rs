//! Read-only, immutable-Version queries. Derived indexes are request-local and
//! disposable; neither Graph truth nor working state is owned by the caller.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{Pool, Sqlite};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::atomic::{AtomicUsize, Ordering};

pub(crate) const EVALUATOR: &str = "story-query/1";
const MAX_SNAPSHOT: usize = 24 * 1024 * 1024;
const MAX_RESULT: usize = 1024 * 1024;
const MAX_RECORDS: usize = 1000;
type Result<T> = std::result::Result<T, String>;
type State = BTreeMap<String, serde_json::Map<String, Value>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Request {
    pub workspace_id: String,
    pub version_id: String,
    pub query: Query,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum Query {
    StateAt {
        path_id: String,
        node_id: String,
        entity_id: String,
        key: String,
        phase: Phase,
    },
    Consistency {
        path_ids: Vec<String>,
    },
    ComparePaths {
        ours_path_id: String,
        theirs_path_id: String,
    },
    Impact {
        node_ids: Vec<String>,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Phase {
    Before,
    After,
}

impl Request {
    fn validate(&self) -> Result<()> {
        let valid_ids = |ids: &[String], max| {
            !ids.is_empty()
                && ids.len() <= max
                && ids.iter().all(|id| super::valid_lower_uuid(id))
                && ids.iter().collect::<BTreeSet<_>>().len() == ids.len()
        };
        let valid = match &self.query {
            Query::StateAt {
                path_id,
                node_id,
                entity_id,
                key,
                ..
            } => {
                [path_id, node_id, entity_id]
                    .iter()
                    .all(|id| super::valid_lower_uuid(id))
                    && !key.is_empty()
                    && key.encode_utf16().count() <= 200
            }
            Query::Consistency { path_ids } => valid_ids(path_ids, 32),
            Query::ComparePaths {
                ours_path_id,
                theirs_path_id,
            } => {
                ours_path_id != theirs_path_id
                    && super::valid_lower_uuid(ours_path_id)
                    && super::valid_lower_uuid(theirs_path_id)
            }
            Query::Impact { node_ids } => valid_ids(node_ids, 100),
        };
        if !super::valid_lower_uuid(&self.workspace_id)
            || !super::valid_lower_uuid(&self.version_id)
            || !valid
        {
            return Err("invalid_story_query".into());
        }
        Ok(())
    }
}

// Bound aggregate native memory under concurrent Agent calls, including the
// snapshot fetch. A permit stays alive until blocking evaluation has finished.
static ACTIVE: AtomicUsize = AtomicUsize::new(0);
struct Permit;
impl Drop for Permit {
    fn drop(&mut self) {
        ACTIVE.fetch_sub(1, Ordering::AcqRel);
    }
}
pub(crate) async fn query(pool: &Pool<Sqlite>, request: Request) -> Result<Value> {
    request.validate()?;
    ACTIVE
        .try_update(Ordering::AcqRel, Ordering::Acquire, |n| {
            (n < 2).then_some(n + 1)
        })
        .map_err(|_| "story_query_busy")?;
    let permit = Permit;
    // One scoped SELECT is a coherent read. Never resolve a moving branch head,
    // fall back to the draft, or load oversized blobs into the process.
    let row: Option<(Option<String>, String)> = sqlx::query_as(
        "SELECT CASE WHEN length(CAST(snapshot_json AS BLOB)) <= 25165824 THEN snapshot_json END,
         snapshot_hash FROM story_workspace_versions WHERE workspace_id=? AND version_id=?",
    )
    .bind(&request.workspace_id)
    .bind(&request.version_id)
    .fetch_optional(pool)
    .await
    .map_err(|_| "story_query_storage_unavailable")?;
    let (snapshot, hash) = row.ok_or("missing_story_version")?;
    let snapshot = snapshot.ok_or("invalid_stored_story_workspace")?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        answer(&snapshot, &hash, &request)
    })
    .await
    .map_err(|_| "story_query_unavailable")?
}

// Limit cumulative evaluation/copy work, not just input and output sizes.
// Exceeding any budget is an error: never report a partial result as complete.
struct Budget {
    steps: usize,
    bytes: usize,
}
impl Budget {
    fn new() -> Self {
        Self {
            steps: 1_000_000,
            bytes: 64 * 1024 * 1024,
        }
    }
    fn charge(&mut self, bytes: usize) -> Result<()> {
        self.steps = self
            .steps
            .checked_sub(1)
            .ok_or("story_query_budget_exceeded")?;
        self.bytes = self
            .bytes
            .checked_sub(bytes)
            .ok_or("story_query_budget_exceeded")?;
        Ok(())
    }
    fn value(&mut self, v: &Value) -> Result<()> {
        self.charge(16)?;
        match v {
            Value::String(s) => self.charge(s.len())?,
            Value::Array(a) => {
                for v in a {
                    self.value(v)?;
                }
            }
            Value::Object(o) => {
                for (k, v) in o {
                    self.charge(k.len())?;
                    self.value(v)?;
                }
            }
            _ => (),
        }
        Ok(())
    }
    fn copy(&mut self, v: &Value) -> Result<Value> {
        self.value(v)?;
        Ok(v.clone())
    }
    fn equal(&mut self, a: Option<&Value>, b: Option<&Value>) -> Result<bool> {
        if let Some(v) = a {
            self.value(v)?;
        }
        if let Some(v) = b {
            self.value(v)?;
        }
        Ok(match (a, b) {
            (Some(a), Some(b)) => json_equal(a, b),
            (None, None) => true,
            _ => false,
        })
    }
}
// JSON object key order is not semantic. Numbers follow the shared JS contract.
fn json_equal(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| json_equal(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(k, v)| b.get(k).is_some_and(|b| json_equal(v, b)))
        }
        _ => a == b,
    }
}
fn text<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().expect("validated field")
}
fn array<'a>(v: &'a Value, key: &str) -> &'a [Value] {
    v[key].as_array().expect("validated array")
}
fn push(out: &mut Vec<Value>, value: Value) -> Result<()> {
    if out.len() >= MAX_RECORDS {
        return Err("story_query_result_limit".into());
    }
    out.push(value);
    Ok(())
}

struct Index<'a> {
    graph: &'a Value,
    nodes: BTreeMap<&'a str, &'a Value>,
    paths: BTreeMap<&'a str, &'a Value>,
}
impl<'a> Index<'a> {
    fn new(graph: &'a Value) -> Self {
        Self {
            graph,
            nodes: array(graph, "nodes")
                .iter()
                .map(|n| (text(n, "id"), n))
                .collect(),
            paths: array(graph, "paths")
                .iter()
                .map(|p| (text(p, "id"), p))
                .collect(),
        }
    }
    fn path(&self, id: &str) -> Result<Vec<&'a str>> {
        let path = self.paths.get(id).ok_or("missing_story_path")?;
        Ok(array(path, "nodeIds")
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect())
    }
    fn initial(&self, budget: &mut Budget) -> Result<State> {
        array(self.graph, "entities")
            .iter()
            .map(|entity| {
                let state = if let Some(value) = entity.get("initialState") {
                    let Value::Object(state) = budget.copy(value)? else {
                        unreachable!("validated state")
                    };
                    state
                } else {
                    serde_json::Map::new()
                };
                Ok((text(entity, "id").to_string(), state))
            })
            .collect()
    }
    fn run(
        &self,
        ids: &[&str],
        state: &mut State,
        path_id: &str,
        issues: &mut Vec<Value>,
        budget: &mut Budget,
    ) -> Result<()> {
        for (path_index, id) in ids.iter().enumerate() {
            budget.charge(0)?;
            let node = self.nodes[id];
            for (condition_index, condition) in array(node, "preconditions").iter().enumerate() {
                budget.charge(0)?;
                let actual = state[text(condition, "entityId")].get(text(condition, "key"));
                let expected = condition.get("value");
                let matched = match text(condition, "operator") {
                    "exists" => actual.is_some(),
                    "not-exists" => actual.is_none(),
                    "equals" => budget.equal(actual, expected)?,
                    "not-equals" => !budget.equal(actual, expected)?,
                    operator => {
                        let mut found = false;
                        if let Some(values) = actual.and_then(Value::as_array) {
                            for value in values {
                                if budget.equal(Some(value), expected)? {
                                    found = true;
                                    break;
                                }
                            }
                        }
                        if operator == "contains" {
                            found
                        } else {
                            !found
                        }
                    }
                };
                if !matched {
                    let mut issue = json!({"code":"story_precondition_failed","severity":"conflict",
                        "pathId":path_id,"pathIndex":path_index,"nodeId":id,"conditionIndex":condition_index,
                        "entityId":condition["entityId"],"key":condition["key"],"operator":condition["operator"]});
                    if let Some(value) = expected {
                        issue["expected"] = budget.copy(value)?;
                    }
                    if let Some(value) = actual {
                        issue["actual"] = budget.copy(value)?;
                    }
                    push(issues, issue)?;
                }
            }
            for effect in array(node, "effects") {
                apply(
                    state.get_mut(text(effect, "entityId")).unwrap(),
                    effect,
                    budget,
                )?;
            }
        }
        Ok(())
    }
}
fn apply(
    record: &mut serde_json::Map<String, Value>,
    effect: &Value,
    budget: &mut Budget,
) -> Result<()> {
    budget.charge(0)?;
    let key = text(effect, "key");
    match text(effect, "operation") {
        "unset" => {
            record.remove(key);
        }
        "set" => {
            record.insert(key.into(), budget.copy(&effect["value"])?);
        }
        operation => {
            let old = record.get(key).filter(|v| v.is_array());
            let mut values = match old {
                Some(v) => match budget.copy(v)? {
                    Value::Array(a) => a,
                    _ => unreachable!(),
                },
                None => vec![],
            };
            let mut matches = Vec::with_capacity(values.len());
            for value in &values {
                matches.push(budget.equal(Some(value), effect.get("value"))?);
            }
            if operation == "add" && !matches.iter().any(|v| *v) {
                values.push(budget.copy(&effect["value"])?);
            }
            if operation == "remove" {
                values = values
                    .into_iter()
                    .zip(matches)
                    .filter_map(|(v, m)| (!m).then_some(v))
                    .collect();
            }
            record.insert(key.into(), Value::Array(values));
        }
    }
    Ok(())
}

fn answer(snapshot: &str, hash: &str, request: &Request) -> Result<Value> {
    request.validate()?;
    if snapshot.len() > MAX_SNAPSHOT {
        return Err("invalid_stored_story_workspace".into());
    }
    let actual = Sha256::digest(snapshot.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    if actual != hash {
        return Err("story_version_hash_mismatch".into());
    }
    let workspace: Value =
        serde_json::from_str(snapshot).map_err(|_| "invalid_stored_story_workspace")?;
    if workspace.as_object().is_none_or(|o| o.len() != 4)
        || workspace["schemaId"] != "https://komyaku.example/schemas/story-workspace/v1"
        || workspace["schemaVersion"] != 1
        || workspace["graph"]["id"] != request.workspace_id
        || workspace["graph"]["documentId"] != workspace["document"]["id"]
    {
        return Err("invalid_stored_story_workspace".into());
    }
    let ids = super::story_document_validation::validate_document_subset(&workspace["document"])?;
    super::story_graph_validation::validate_graph_schema(&workspace["graph"], &ids)
        .map_err(str::to_string)?;
    let index = Index::new(&workspace["graph"]);
    let mut budget = Budget::new();
    let result = match &request.query {
        Query::StateAt {
            path_id,
            node_id,
            entity_id,
            key,
            phase,
        } => state_at(&index, path_id, node_id, entity_id, key, phase, &mut budget)?,
        Query::Consistency { path_ids } => {
            let mut issues = vec![];
            for path_id in path_ids {
                let path = index.path(path_id)?;
                let mut state = index.initial(&mut budget)?;
                index.run(&path, &mut state, path_id, &mut issues, &mut budget)?;
            }
            json!({"consistent":issues.is_empty(),"issues":issues})
        }
        Query::ComparePaths {
            ours_path_id,
            theirs_path_id,
        } => compare(&index, ours_path_id, theirs_path_id, &mut budget)?,
        Query::Impact { node_ids } => impact(&index, node_ids, &mut budget)?,
    };
    let response = json!({"workspaceId":request.workspace_id,"versionId":request.version_id,
        "snapshotHash":hash,"evaluatorVersion":EVALUATOR,"graphSchemaVersion":1,
        "query":request.query,"result":result});
    if serde_json::to_vec(&response)
        .map_err(|_| "story_query_unavailable")?
        .len()
        > MAX_RESULT
    {
        return Err("story_query_result_limit".into());
    }
    Ok(response)
}

fn state_at(
    index: &Index<'_>,
    path_id: &str,
    node_id: &str,
    entity_id: &str,
    key: &str,
    phase: &Phase,
    budget: &mut Budget,
) -> Result<Value> {
    let path = index.path(path_id)?;
    let position = path
        .iter()
        .position(|id| *id == node_id)
        .ok_or("story_node_not_in_path")?;
    let entity = array(index.graph, "entities")
        .iter()
        .find(|e| text(e, "id") == entity_id)
        .ok_or("missing_story_entity_reference")?;
    // Only this property is evaluated. Other entities, later scenes and complete
    // before/after state copies are unnecessary for a point knowledge query.
    let mut record = serde_json::Map::new();
    let mut initial = json!({"exists":false});
    if let Some(value) = entity["initialState"].get(key) {
        initial = json!({"exists":true,"value":budget.copy(value)?});
        record.insert(key.into(), budget.copy(value)?);
    }
    let mut effects = vec![];
    for id in path
        .iter()
        .take(position + usize::from(*phase == Phase::After))
    {
        for (effect_index, effect) in array(index.nodes[id], "effects").iter().enumerate() {
            budget.charge(0)?;
            if text(effect, "entityId") == entity_id && text(effect, "key") == key {
                apply(&mut record, effect, budget)?;
                push(
                    &mut effects,
                    json!({"nodeId":id,"effectIndex":effect_index}),
                )?;
            }
        }
    }
    let mut result =
        json!({"exists":record.contains_key(key),"evidence":{"initial":initial,"effects":effects}});
    if let Some(value) = record.get(key) {
        result["value"] = budget.copy(value)?;
    }
    Ok(result)
}

fn compare(
    index: &Index<'_>,
    ours_id: &str,
    theirs_id: &str,
    budget: &mut Budget,
) -> Result<Value> {
    let ours = index.path(ours_id)?;
    let theirs = index.path(theirs_id)?;
    let prefix = ours.iter().zip(&theirs).take_while(|(a, b)| a == b).count();
    if prefix == ours.len() && prefix == theirs.len() {
        return Err("story_paths_do_not_diverge".into());
    }
    let suffix = ours[prefix..]
        .iter()
        .rev()
        .zip(theirs[prefix..].iter().rev())
        .take_while(|(a, b)| a == b)
        .count();
    let mut base = index.initial(budget)?;
    index.run(&ours[..prefix], &mut base, ours_id, &mut vec![], budget)?;
    let mut copy_state = |state: &State| -> Result<State> {
        for record in state.values() {
            for value in record.values() {
                budget.value(value)?;
            }
        }
        Ok(state.clone())
    };
    let mut left = copy_state(&base)?;
    let mut right = copy_state(&base)?;
    index.run(
        &ours[prefix..ours.len() - suffix],
        &mut left,
        ours_id,
        &mut vec![],
        budget,
    )?;
    index.run(
        &theirs[prefix..theirs.len() - suffix],
        &mut right,
        theirs_id,
        &mut vec![],
        budget,
    )?;
    let mut conflicts = vec![];
    for (entity_id, record) in &base {
        let keys: BTreeSet<_> = record
            .keys()
            .chain(left[entity_id].keys())
            .chain(right[entity_id].keys())
            .collect();
        for key in keys {
            let b = record.get(key);
            let l = left[entity_id].get(key);
            let r = right[entity_id].get(key);
            if !budget.equal(b, l)? && !budget.equal(b, r)? && !budget.equal(l, r)? {
                let mut conflict = json!({"entityId":entity_id,"key":key});
                for (name, value) in [("base", b), ("ours", l), ("theirs", r)] {
                    if let Some(v) = value {
                        conflict[name] = budget.copy(v)?;
                    }
                }
                push(&mut conflicts, conflict)?;
            }
        }
    }
    let mut issues = vec![];
    for (id, path) in [(ours_id, &ours), (theirs_id, &theirs)] {
        let mut state = index.initial(budget)?;
        index.run(path, &mut state, id, &mut issues, budget)?;
    }
    Ok(
        json!({"sharedPrefixNodeIds":ours[..prefix],"sharedSuffixNodeIds":ours[ours.len()-suffix..],
        "oursNodeIds":ours[prefix..ours.len()-suffix],"theirsNodeIds":theirs[prefix..theirs.len()-suffix],
        "conflicts":conflicts,"issues":issues,"mergeable":conflicts.is_empty() && issues.is_empty()}),
    )
}

fn impact(index: &Index<'_>, seeds: &[String], budget: &mut Budget) -> Result<Value> {
    if seeds
        .iter()
        .any(|id| !index.nodes.contains_key(id.as_str()))
    {
        return Err("invalid_story_impact_request".into());
    }
    let mut adjacency: BTreeMap<&str, Vec<(&str, &str, Option<&str>)>> = BTreeMap::new();
    for edge in array(index.graph, "edges") {
        budget.charge(0)?;
        let (from, to, kind, id) = (
            text(edge, "from"),
            text(edge, "to"),
            text(edge, "type"),
            text(edge, "id"),
        );
        match kind {
            "requires" | "reference" | "resolves" => {
                adjacency
                    .entry(to)
                    .or_default()
                    .push((from, kind, Some(id)))
            }
            "contradicts" => {
                adjacency
                    .entry(from)
                    .or_default()
                    .push((to, kind, Some(id)));
                adjacency
                    .entry(to)
                    .or_default()
                    .push((from, kind, Some(id)));
            }
            _ => adjacency
                .entry(from)
                .or_default()
                .push((to, kind, Some(id))),
        }
    }
    let mut readers: BTreeMap<(&str, &str), Vec<&str>> = BTreeMap::new();
    for node in array(index.graph, "nodes") {
        for rule in array(node, "preconditions") {
            budget.charge(0)?;
            readers
                .entry((text(rule, "entityId"), text(rule, "key")))
                .or_default()
                .push(text(node, "id"));
        }
    }
    let mut expanded = BTreeSet::new();
    let mut visited: BTreeSet<&str> = seeds.iter().map(String::as_str).collect();
    let mut pending: VecDeque<&str> = seeds.iter().map(String::as_str).collect();
    let mut impacts = vec![];
    while let Some(source) = pending.pop_front() {
        // Explicit edge ordering followed by state readers preserves first-witness
        // BFS semantics without materializing the writer × reader cross product.
        let mut links = adjacency.get(source).cloned().unwrap_or_default();
        for effect in array(index.nodes[source], "effects") {
            budget.charge(0)?;
            let key = (text(effect, "entityId"), text(effect, "key"));
            if expanded.insert(key) {
                for target in readers.get(&key).into_iter().flatten() {
                    budget.charge(0)?;
                    if *target != source {
                        links.push((*target, "state-dependency", None));
                    }
                }
            }
        }
        for (target, reason, edge_id) in links {
            budget.charge(0)?;
            if visited.insert(target) {
                pending.push_back(target);
                push(
                    &mut impacts,
                    json!({"nodeId":target,"viaNodeId":source,"reason":reason,"edgeId":edge_id}),
                )?;
            }
        }
    }
    Ok(json!({"impacts":impacts}))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn id(n: usize) -> String {
        format!("00000000-0000-4000-8000-{n:012x}")
    }
    fn fixture() -> Value {
        serde_json::from_str(include_str!(
            "../../../../packages/story-graph/test/fixtures/query-workspace.json"
        ))
        .unwrap()
    }
    fn hash(s: &str) -> String {
        Sha256::digest(s.as_bytes())
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }
    fn request(query: Value) -> Request {
        serde_json::from_value(json!({"workspaceId":id(3),"versionId":id(200),"query":query}))
            .unwrap()
    }
    fn state_query() -> Value {
        json!({"type":"state-at","pathId":id(40),"nodeId":id(23),"entityId":id(10),"key":"knowledge","phase":"before"})
    }
    fn run(workspace: &Value, q: Value) -> Result<Value> {
        let snapshot = workspace.to_string();
        answer(&snapshot, &hash(&snapshot), &request(q))
    }

    #[test]
    fn shared_query_corpus_matches_reference_results_with_exact_provenance() {
        let corpus: Value = serde_json::from_str(include_str!(
            "../../../../packages/story-graph/test/fixtures/query-conformance.json"
        ))
        .unwrap();
        for case in corpus.as_array().unwrap() {
            let mut workspace = fixture();
            for change in case
                .get("changes")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let (parent, key) = change["pointer"]
                    .as_str()
                    .unwrap()
                    .rsplit_once('/')
                    .unwrap();
                let key = key.replace("~1", "/").replace("~0", "~");
                let parent = workspace.pointer_mut(parent).unwrap();
                if change["remove"] == true {
                    parent.as_object_mut().unwrap().remove(&key);
                } else if let Some(object) = parent.as_object_mut() {
                    object.insert(key, change["value"].clone());
                } else {
                    parent[key.parse::<usize>().unwrap()] = change["value"].clone();
                }
            }
            let output = run(&workspace, case["query"].clone())
                .unwrap_or_else(|e| panic!("{}: {e}", case["name"]));
            assert_eq!(output["result"], case["expected"], "{}", case["name"]);
            assert_eq!(output["snapshotHash"], hash(&workspace.to_string()));
            assert_eq!(output["versionId"], id(200));
            assert_eq!(output["query"], case["query"]);
            assert_eq!(output["evaluatorVersion"], EVALUATOR);
            assert_eq!(output.as_object().unwrap().len(), 7);
        }
    }

    #[test]
    fn refuses_bad_requests_corrupt_truth_and_missing_targets() {
        let snapshot = fixture().to_string();
        let input = request(state_query());
        assert_eq!(
            answer(&snapshot, &"0".repeat(64), &input).unwrap_err(),
            "story_version_hash_mismatch"
        );
        for field in ["snapshotJson", "authorId", "expectedRevision"] {
            let mut input = serde_json::to_value(&input).unwrap();
            input[field] = json!("spoof");
            assert!(serde_json::from_value::<Request>(input).is_err());
        }
        let mut extra = state_query();
        extra["versionId"] = json!(id(300));
        assert!(serde_json::from_value::<Query>(extra).is_err());
        let mut unknown = state_query();
        unknown["phase"] = json!("current");
        assert!(serde_json::from_value::<Query>(unknown).is_err());
        for q in [
            json!({"type":"impact","nodeIds":[]}),
            json!({"type":"impact","nodeIds":[id(20),id(20)]}),
            json!({"type":"consistency","pathIds":vec![id(40);33]}),
            json!({"type":"compare-paths","oursPathId":id(40),"theirsPathId":id(40)}),
        ] {
            assert_eq!(run(&fixture(), q).unwrap_err(), "invalid_story_query");
        }
        for (field, error) in [
            ("pathId", "missing_story_path"),
            ("nodeId", "story_node_not_in_path"),
            ("entityId", "missing_story_entity_reference"),
        ] {
            let mut q = state_query();
            q[field] = json!(id(999));
            assert_eq!(run(&fixture(), q).unwrap_err(), error);
        }
        let mut broken = fixture();
        broken["graph"]["nodes"][0]["documentRefs"][0]["nodeId"] = json!(id(999));
        assert_eq!(
            run(&broken, state_query()).unwrap_err(),
            "missing_canonical_node_reference"
        );
        broken = fixture();
        broken["graph"]["documentId"] = json!(id(999));
        assert_eq!(
            run(&broken, state_query()).unwrap_err(),
            "invalid_stored_story_workspace"
        );
        broken = fixture();
        broken["graph"]["paths"][1]["nodeIds"] = broken["graph"]["paths"][0]["nodeIds"].clone();
        assert_eq!(
            run(
                &broken,
                json!({"type":"compare-paths","oursPathId":id(40),"theirsPathId":id(41)})
            )
            .unwrap_err(),
            "story_paths_do_not_diverge"
        );
    }

    #[test]
    fn resource_limits_refuse_incomplete_answers_instead_of_claiming_success() {
        let mut large = fixture();
        large["graph"]["entities"][0]["initialState"]["knowledge"] = json!("x".repeat(MAX_RESULT));
        assert_eq!(
            run(&large, state_query()).unwrap_err(),
            "story_query_result_limit"
        );
        let mut heavy = fixture();
        for (n, node) in heavy["graph"]["nodes"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .enumerate()
        {
            node["effects"]=json!((0..100).map(|i|json!({"entityId":id(10),"key":"knowledge","operation":"add","value":format!("{n}-{i}{}","x".repeat(4096))})).collect::<Vec<_>>());
        }
        let mut q = state_query();
        q["nodeId"] = json!(id(24));
        q["phase"] = json!("after");
        assert_eq!(run(&heavy, q).unwrap_err(), "story_query_budget_exceeded");
        let mut many = fixture();
        many["graph"]["paths"] = json!([]);
        many["graph"]["nodes"] = json!([]);
        many["graph"]["edges"] = json!([]);
        for n in 0..1002 {
            many["graph"]["nodes"].as_array_mut().unwrap().push(json!({"id":id(2000+n),"kind":"content","subtype":"scene","title":"場面 Scene 场景","documentRefs":[],"preconditions":[],"effects":[]}));
            if n > 0 {
                many["graph"]["edges"]
                    .as_array_mut()
                    .unwrap()
                    .push(json!({"id":id(4000+n),"from":id(2000),"to":id(2000+n),"type":"causes"}));
            }
        }
        assert_eq!(
            run(&many, json!({"type":"impact","nodeIds":[id(2000)]})).unwrap_err(),
            "story_query_result_limit"
        );
        // Exactly the maximum is complete and accepted.
        many["graph"]["edges"].as_array_mut().unwrap().pop();
        assert_eq!(
            run(&many, json!({"type":"impact","nodeIds":[id(2000)]})).unwrap()["result"]["impacts"]
                .as_array()
                .unwrap()
                .len(),
            1000
        );
    }

    #[tokio::test]
    async fn immutable_queries_survive_edits_new_versions_restart_and_never_write() {
        use super::super::story_workspace_runtime as runtime;
        let file = std::env::temp_dir().join(format!(
            "komyaku-query-{}-{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::File::create(&file).unwrap();
        let url = format!("sqlite:{}", file.display());
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect(&url)
            .await
            .unwrap();
        super::super::story_workspace_store::migrate(&db)
            .await
            .unwrap();
        let workspace = fixture();
        runtime::initialize(&db,serde_json::from_value(json!({"operationId":id(300),"versionId":id(200),"branchId":id(400),"branchName":"Main","label":null,
            "document":workspace["document"],"graph":workspace["graph"]})).unwrap()).await.unwrap();
        let input = request(state_query());
        let first = query(&db, input.clone()).await.unwrap();
        assert_eq!(first["result"]["value"], json!([id(11)]));
        let mut changed = workspace["graph"]["nodes"][1].clone();
        changed["effects"] = json!([]);
        runtime::edit(
            &db,
            runtime::EditRequest {
                operation_id: id(301),
                command_json: json!({"documentId":id(1),"graphId":id(3),"expectedRevision":1,
            "operations":[{"type":"put","collection":"nodes","value":changed}]})
                .to_string(),
            },
        )
        .await
        .unwrap();
        assert_eq!(query(&db, input.clone()).await.unwrap(), first);
        runtime::capture(&db,serde_json::from_value(json!({"workspaceId":id(3),"operationId":id(302),"expectedRevision":2,"versionId":id(201),"branchId":id(400),
            "branchName":"Main","expectedBranchId":id(400),"expectedHeadId":id(200),"kind":"named","label":null})).unwrap()).await.unwrap();
        db.close().await;
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect(&url)
            .await
            .unwrap();
        let before: i64 = sqlx::query_scalar("SELECT total_changes()")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(query(&db, input.clone()).await.unwrap(), first);
        let mut newer = input.clone();
        newer.version_id = id(201);
        let second = query(&db, newer).await.unwrap();
        assert_eq!(second["result"]["value"], json!([]));
        assert_ne!(first["snapshotHash"], second["snapshotHash"]);
        let mut foreign = input.clone();
        foreign.workspace_id = id(999);
        assert_eq!(
            query(&db, foreign).await.unwrap_err(),
            "missing_story_version"
        );
        let mut missing = input.clone();
        missing.version_id = id(999);
        assert_eq!(
            query(&db, missing).await.unwrap_err(),
            "missing_story_version"
        );
        let after: i64 = sqlx::query_scalar("SELECT total_changes()")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(before, after);
        sqlx::query("UPDATE story_workspace_versions SET snapshot_hash=? WHERE version_id=?")
            .bind("0".repeat(64))
            .bind(id(200))
            .execute(&db)
            .await
            .unwrap();
        assert_eq!(
            query(&db, input.clone()).await.unwrap_err(),
            "story_version_hash_mismatch"
        );
        sqlx::query("UPDATE story_workspace_versions SET snapshot_json=CAST(zeroblob(25165825) AS TEXT) WHERE version_id=?").bind(id(200)).execute(&db).await.unwrap();
        assert_eq!(
            query(&db, input).await.unwrap_err(),
            "invalid_stored_story_workspace"
        );
        db.close().await;
        std::fs::remove_file(file).unwrap();
    }
}
