use super::*;
use narrative::{Declarations, Phase};
use std::collections::{BTreeMap, BTreeSet};
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Entity {
    pub id: Id,
    pub name: String,
    pub kind: String,
    pub initial_state: BTreeMap<String, Value>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Rule {
    pub id: Id,
    pub scene: Id,
    pub entity: Id,
    pub key: String,
    pub operation: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present_value"
    )]
    pub value: Option<Value>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Assertion {
    pub id: Id,
    pub path: Id,
    pub scene: Id,
    pub entity: Id,
    pub key: String,
    pub phase: Phase,
    pub operator: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present_value"
    )]
    pub value: Option<Value>,
}
fn present_value<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Option<Value>, D::Error> {
    Value::deserialize(deserializer).map(Some)
}
const CONDITIONS: &[&str] = &[
    "equals",
    "not-equals",
    "contains",
    "not-contains",
    "exists",
    "not-exists",
];
const EFFECTS: &[&str] = &["set", "unset", "add", "remove"];
fn key_ok(k: &str) -> bool {
    !k.trim().is_empty()
        && k == k.trim()
        && k.chars().count() <= 200
        && !k.chars().any(char::is_control)
}
fn value_ok(v: &Value, depth: usize, budget: &mut usize) -> bool {
    if depth > 12 || *budget == 0 {
        return false;
    }
    *budget -= 1;
    match v {
        Value::String(s) => s.chars().count() <= 4096,
        Value::Array(a) => a.len() <= 256 && a.iter().all(|v| value_ok(v, depth + 1, budget)),
        Value::Object(o) => {
            o.len() <= 128
                && o.iter()
                    .all(|(k, v)| key_ok(k) && value_ok(v, depth + 1, budget))
        }
        _ => true,
    }
}
fn rule_ok(op: &str, v: &Option<Value>) -> bool {
    (CONDITIONS.contains(&op) || EFFECTS.contains(&op))
        && v.is_some() != ["exists", "not-exists", "unset"].contains(&op)
}
pub fn validate(
    document: &Document,
    d: &Declarations,
    ids: &mut BTreeSet<Id>,
) -> std::result::Result<(), String> {
    if d.entities.len() > 256 || d.rules.len() > 2048 || d.assertions.len() > 256 {
        return Err("limit_exceeded".into());
    }
    let mut entities: BTreeSet<_> = document
        .graph()
        .nodes()
        .values()
        .filter(|n| n.type_id == domain::CHARACTER)
        .map(|n| n.id)
        .chain(d.facts.iter().map(|f| f.id))
        .collect();
    let mut names = BTreeSet::new();
    let mut budget = 65536;
    for e in &d.entities {
        if !ids.insert(e.id)
            || !entities.insert(e.id)
            || !key_ok(&e.name)
            || !names.insert(&e.name)
            || !["location", "object", "event", "relationship", "rule"].contains(&e.kind.as_str())
            || e.initial_state.len() > 128
            || !e
                .initial_state
                .iter()
                .all(|(k, v)| key_ok(k) && k != "knowledge" && value_ok(v, 0, &mut budget))
        {
            return Err("narrative_invalid".into());
        }
    }
    let scene = |id: &Id| {
        document
            .graph()
            .nodes()
            .get(id)
            .is_some_and(|n| n.type_id == domain::SCENE)
    };
    let paths = paths::definitions(document)?;
    let mut counts = BTreeMap::<Id, usize>::new();
    for e in &d.events {
        *counts.entry(e.scene).or_default() += 1;
    }
    for r in &d.rules {
        let count = counts.entry(r.scene).or_default();
        *count += 1;
        if *count > 100
            || !ids.insert(r.id)
            || !scene(&r.scene)
            || !entities.contains(&r.entity)
            || !key_ok(&r.key)
            || r.key == "knowledge"
            || !rule_ok(&r.operation, &r.value)
            || r.value
                .as_ref()
                .is_some_and(|v| !value_ok(v, 0, &mut budget))
        {
            return Err("narrative_invalid".into());
        }
    }
    for a in &d.assertions {
        if !ids.insert(a.id)
            || !entities.contains(&a.entity)
            || !key_ok(&a.key)
            || a.key == "knowledge"
            || !CONDITIONS.contains(&a.operator.as_str())
            || !rule_ok(&a.operator, &a.value)
            || !paths
                .iter()
                .any(|p| p.id == a.path && p.scenes.contains(&a.scene))
            || a.value
                .as_ref()
                .is_some_and(|v| !value_ok(v, 0, &mut budget))
        {
            return Err("narrative_invalid".into());
        }
    }
    Ok(())
}
type State = BTreeMap<Id, BTreeMap<String, Value>>;
fn initial(d: &Declarations) -> State {
    d.entities
        .iter()
        .map(|e| (e.id, e.initial_state.clone()))
        .chain(d.rules.iter().map(|r| (r.entity, BTreeMap::new())))
        .fold(BTreeMap::new(), |mut result, (id, state)| {
            result.entry(id).or_insert(state);
            result
        })
}
fn matches(actual: Option<&Value>, op: &str, expected: Option<&Value>) -> bool {
    match op {
        "exists" => actual.is_some(),
        "not-exists" => actual.is_none(),
        "equals" => actual == expected,
        "not-equals" => actual != expected,
        "contains" => actual
            .and_then(Value::as_array)
            .is_some_and(|a| a.iter().any(|v| Some(v) == expected)),
        "not-contains" => !actual
            .and_then(Value::as_array)
            .is_some_and(|a| a.iter().any(|v| Some(v) == expected)),
        _ => false,
    }
}
fn apply(state: &mut State, r: &Rule) {
    let record = state.entry(r.entity).or_default();
    match r.operation.as_str() {
        "set" => {
            record.insert(r.key.clone(), r.value.clone().expect("validated value"));
        }
        "unset" => {
            record.remove(&r.key);
        }
        "add" | "remove" => {
            let value = r.value.as_ref().expect("validated value");
            let mut values = record
                .get(&r.key)
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            if r.operation == "add" {
                if !values.contains(value) {
                    values.push(value.clone());
                }
            } else {
                values.retain(|v| v != value);
            }
            record.insert(r.key.clone(), Value::Array(values));
        }
        _ => {}
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Evaluation {
    pub issues: Vec<StateIssue>,
    pub tests: Vec<StateTest>,
    pub final_state: State,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StateIssue {
    pub scene: Id,
    pub entity: Id,
    pub key: String,
    pub operator: String,
    pub expected: Option<Value>,
    pub actual: Option<Value>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StateTest {
    pub id: Id,
    pub passed: bool,
    pub actual: Option<Value>,
}
pub fn evaluate(d: &Declarations, scenes: &[Id], path: Id) -> Evaluation {
    let mut state = initial(d);
    let mut issues = vec![];
    let mut tests = vec![];
    let check = |scene: Id, phase: Phase, state: &State, tests: &mut Vec<StateTest>| {
        for a in d
            .assertions
            .iter()
            .filter(|a| a.path == path && a.scene == scene && a.phase == phase)
        {
            let actual = state.get(&a.entity).and_then(|s| s.get(&a.key));
            tests.push(StateTest {
                id: a.id,
                passed: matches(actual, &a.operator, a.value.as_ref()),
                actual: actual.cloned(),
            });
        }
    };
    for scene in scenes {
        check(*scene, Phase::Before, &state, &mut tests);
        for r in d
            .rules
            .iter()
            .filter(|r| r.scene == *scene && CONDITIONS.contains(&r.operation.as_str()))
        {
            let actual = state.get(&r.entity).and_then(|s| s.get(&r.key));
            if !matches(actual, &r.operation, r.value.as_ref()) {
                issues.push(StateIssue {
                    scene: *scene,
                    entity: r.entity,
                    key: r.key.clone(),
                    operator: r.operation.clone(),
                    expected: r.value.clone(),
                    actual: actual.cloned(),
                });
            }
        }
        for r in d
            .rules
            .iter()
            .filter(|r| r.scene == *scene && EFFECTS.contains(&r.operation.as_str()))
        {
            apply(&mut state, r);
        }
        check(*scene, Phase::After, &state, &mut tests);
    }
    Evaluation {
        issues,
        tests,
        final_state: state,
    }
}
pub fn apply_shared(d: &Declarations, graph: &mut Value) -> std::result::Result<(), String> {
    graph["entities"].as_array_mut().ok_or("narrative_invalid")?.extend(d.entities.iter().map(|e|json!({"id":e.id,"type":e.kind,"name":e.name,"initialState":e.initial_state,"metadata":{},"extensions":{}})));
    for r in &d.rules {
        let node = graph["nodes"]
            .as_array_mut()
            .ok_or("narrative_invalid")?
            .iter_mut()
            .find(|n| n["id"].as_str() == Some(r.scene.to_string().as_str()))
            .ok_or("narrative_invalid")?;
        let condition = CONDITIONS.contains(&r.operation.as_str());
        let mut value = json!({"entityId":r.entity,"key":r.key});
        value[if condition { "operator" } else { "operation" }] = json!(r.operation);
        if let Some(v) = &r.value {
            value["value"] = v.clone();
        }
        node[if condition {
            "preconditions"
        } else {
            "effects"
        }]
        .as_array_mut()
        .ok_or("narrative_invalid")?
        .push(value);
    }
    Ok(())
}
#[derive(Serialize)]
pub struct QueryResult {
    pub exists: bool,
    pub value: Option<Value>,
}
#[tauri::command]
pub fn state_query(
    window: tauri::WebviewWindow,
    host: tauri::State<Host>,
    path: Id,
    scene: Id,
    entity: Id,
    key: String,
    phase: Phase,
) -> std::result::Result<QueryResult, String> {
    allowed(&window)?;
    host.engine
        .read_document(|document, _| {
            let d = narrative::declarations(document)?;
            narrative::validate(document, &d)?;
            let selected = paths::definitions(document)?
                .into_iter()
                .find(|p| p.id == path)
                .ok_or("invalid_path")?;
            let index = selected
                .scenes
                .iter()
                .position(|id| *id == scene)
                .ok_or("narrative_invalid")?;
            if !key_ok(&key)
                || key == "knowledge"
                || !(d.entities.iter().any(|e| e.id == entity)
                    || d.facts.iter().any(|e| e.id == entity)
                    || document
                        .graph()
                        .nodes()
                        .get(&entity)
                        .is_some_and(|n| n.type_id == domain::CHARACTER))
            {
                return Err("narrative_invalid".into());
            }
            let end = index + usize::from(phase == Phase::After);
            let state = evaluate(&d, &selected.scenes[..end], path).final_state;
            let value = state.get(&entity).and_then(|s| s.get(&key)).cloned();
            Ok(QueryResult {
                exists: value.is_some(),
                value,
            })
        })
        .map_err(|e| e.code)?
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Impact {
    pub node: Id,
    pub via: Id,
    pub reason: &'static str,
}
#[tauri::command]
pub fn story_impact(
    window: tauri::WebviewWindow,
    host: tauri::State<Host>,
    scene: Id,
) -> std::result::Result<Vec<Impact>, String> {
    allowed(&window)?;
    host.engine
        .read_document(|document, _| impact(document, scene))
        .map_err(|e| e.code)?
}
pub fn impact(document: &Document, scene: Id) -> std::result::Result<Vec<Impact>, String> {
    if document
        .graph()
        .nodes()
        .get(&scene)
        .is_none_or(|n| n.type_id != domain::SCENE)
    {
        return Err("narrative_invalid".into());
    }
    let d = narrative::declarations(document)?;
    narrative::validate(document, &d)?;
    let mut links = BTreeMap::<Id, Vec<(Id, &'static str)>>::new();
    for p in paths::definitions(document)? {
        for pair in p.scenes.windows(2) {
            links
                .entry(pair[0])
                .or_default()
                .push((pair[1], "sequence"));
        }
    }
    for f in &d.foreshadows {
        links
            .entry(f.source)
            .or_default()
            .push((f.target, "foreshadows"));
    }
    for r in d
        .rules
        .iter()
        .filter(|r| EFFECTS.contains(&r.operation.as_str()))
    {
        for reader in d.rules.iter().filter(|x| {
            CONDITIONS.contains(&x.operation.as_str())
                && x.entity == r.entity
                && x.key == r.key
                && x.scene != r.scene
        }) {
            links
                .entry(r.scene)
                .or_default()
                .push((reader.scene, "state-dependency"));
        }
    }
    for r in d
        .events
        .iter()
        .filter(|r| r.operation != narrative::Operation::Require)
    {
        for reader in d.events.iter().filter(|x| {
            x.operation == narrative::Operation::Require
                && x.character == r.character
                && x.scene != r.scene
        }) {
            links
                .entry(r.scene)
                .or_default()
                .push((reader.scene, "state-dependency"));
        }
    }
    let mut visited = BTreeSet::from([scene]);
    let mut pending = std::collections::VecDeque::from([scene]);
    let mut result = vec![];
    while let Some(via) = pending.pop_front() {
        for &(node, reason) in links.get(&via).into_iter().flatten() {
            if visited.insert(node) {
                pending.push_back(node);
                result.push(Impact { node, via, reason });
            }
        }
    }
    Ok(result)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (Document, Declarations, Id, Id, Vec<Id>) {
        let registry = domain::registry();
        let document = domain::initial_document(&registry);
        let path = paths::definitions(&document).unwrap().remove(0);
        let entity = Id::new_v4();
        let mut d = Declarations::default();
        d.entities.push(Entity {
            id: entity,
            name: "鍵".into(),
            kind: "object".into(),
            initial_state: BTreeMap::from([("owner".into(), json!("誰も持たない"))]),
        });
        (document, d, entity, path.id, path.scenes)
    }
    #[test]
    fn null_absence_order_and_set_semantics_match_contract() {
        let (document, mut d, entity, path, scenes) = fixture();
        for (scene, operation, key, value) in [
            (scenes[0], "set", "owner", Some(Value::Null)),
            (scenes[1], "exists", "owner", None),
            (scenes[1], "add", "colors", Some(json!("青"))),
            (scenes[1], "add", "colors", Some(json!("青"))),
            (scenes[2], "unset", "owner", None),
        ] {
            d.rules.push(Rule {
                id: Id::new_v4(),
                scene,
                entity,
                key: key.into(),
                operation: operation.into(),
                value,
            });
        }
        d.assertions.push(Assertion {
            id: Id::new_v4(),
            path,
            scene: scenes[1],
            entity,
            key: "owner".into(),
            phase: Phase::Before,
            operator: "equals".into(),
            value: Some(Value::Null),
        });
        let wire = serde_json::to_value(&d).unwrap();
        let decoded: Declarations = serde_json::from_value(wire).unwrap();
        assert_eq!(decoded.rules[0].value, Some(Value::Null));
        narrative::validate(&document, &decoded).unwrap();
        let report = evaluate(&decoded, &scenes, path);
        assert!(report.issues.is_empty());
        assert!(report.tests[0].passed);
        assert!(!report.final_state[&entity].contains_key("owner"));
        assert_eq!(report.final_state[&entity]["colors"], json!(["青"]));
        d.rules[0].value = None;
        assert!(narrative::validate(&document, &d).is_err());
    }
    #[test]
    fn preconditions_use_incoming_state_and_invalid_edits_roll_back() {
        let (document, mut d, entity, path, scenes) = fixture();
        for op in ["set", "equals"] {
            d.rules.push(Rule {
                id: Id::new_v4(),
                scene: scenes[0],
                entity,
                key: "owner".into(),
                operation: op.into(),
                value: Some(json!("蓮")),
            });
        }
        let registry = domain::registry();
        let mut editor = Editor::new(document.clone(), 10)
            .unwrap()
            .with_validator(Arc::new(domain::Validator(registry)))
            .unwrap();
        editor
            .execute(narrative::command(&document, d.clone()).unwrap())
            .unwrap();
        assert_eq!(evaluate(&d, &scenes, path).issues.len(), 1);
        let impact = impact(editor.document(), scenes[0]).unwrap();
        assert!(impact.iter().any(|i| i.node == scenes[1]));
        let other = paths::definitions(&document).unwrap().remove(1);
        let result = evaluate(&d, &other.scenes, other.id);
        if !other.scenes.contains(&scenes[0]) {
            assert_eq!(result.final_state[&entity]["owner"], json!("誰も持たない"));
        }
        d.rules[0].entity = Id::new_v4();
        assert!(narrative::command(editor.document(), d).is_err());
        editor.undo().unwrap();
        assert_eq!(editor.document().extensions, document.extensions);
    }
    #[test]
    #[ignore = "writes cross-engine generic state fixture"]
    fn state_fixture() {
        let (document, mut d, entity, path, scenes) = fixture();
        for (scene, op, value) in [
            (scenes[0], "set", Some(Value::Null)),
            (scenes[1], "exists", None),
            (scenes[1], "set", Some(json!("蓮"))),
            (scenes[2], "equals", Some(json!("蓮"))),
        ] {
            d.rules.push(Rule {
                id: Id::new_v4(),
                scene,
                entity,
                key: "owner".into(),
                operation: op.into(),
                value,
            });
        }
        d.assertions.push(Assertion {
            id: Id::new_v4(),
            path,
            scene: scenes[1],
            entity,
            key: "owner".into(),
            phase: Phase::Before,
            operator: "equals".into(),
            value: Some(Value::Null),
        });
        let mut editor = Editor::new(document.clone(), 10).unwrap();
        editor
            .execute(narrative::command(&document, d).unwrap())
            .unwrap();
        let fixture = json!({"workspace":shared_workspace::project(editor.document()).unwrap(),"report":narrative::report(editor.document(),1).unwrap()});
        std::fs::write(
            "/private/tmp/komyaku-state-fixture.json",
            serde_json::to_vec(&fixture).unwrap(),
        )
        .unwrap();
    }
}
