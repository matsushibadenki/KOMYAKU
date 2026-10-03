use crate::{
    AcxError, EDIT, GraphHost, Intent, MAX_MESSAGE_BYTES, OBSERVE, PROFILE, RUN, Result, Snapshot,
    check_snapshot, hash_bytes, hash_json, intent::compile_edit,
};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use unge_core::{Command, Id};
use unge_executor::{Cancellation, Registry, Scheduler, Status};

/// Configured by the host, never supplied in agent requests. Denies edits/runs by default.
#[derive(Clone)]
pub struct Policy {
    pub allow_edit: bool,
    pub allow_run: bool,
    pub create_types: BTreeSet<String>,
    pub execute_types: BTreeSet<String>,
    pub ttl_seconds: u64,
    pub max_sessions: usize,
    pub max_nodes: usize,
    pub max_run_nodes: usize,
}
impl Default for Policy {
    fn default() -> Self {
        Self {
            allow_edit: false,
            allow_run: false,
            create_types: BTreeSet::new(),
            execute_types: BTreeSet::new(),
            ttl_seconds: 120,
            max_sessions: 128,
            max_nodes: 10_000,
            max_run_nodes: 256,
        }
    }
}
impl Policy {
    /// Example authority for the two built-in arithmetic executors only.
    pub fn math_demo() -> Self {
        let types = BTreeSet::from(["math.number".into(), "math.add".into()]);
        Self {
            allow_edit: true,
            allow_run: true,
            create_types: types.clone(),
            execute_types: types,
            ..Self::default()
        }
    }
}
struct Session {
    preflight: Value,
    input: Intent,
    command: Option<Command>,
    authorization: Option<String>,
    commit: Option<String>,
    execution: Option<Value>,
    recovery: Option<Value>,
    started: bool,
    after_revision: Option<u64>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PreflightArgs {
    input: Intent,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BoundArgs {
    preflight_id: String,
    preflight_digest: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CommitArgs {
    preflight_id: String,
    preflight_digest: String,
    authorization: String,
    input: Intent,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExecuteArgs {
    commit_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RecoverArgs {
    commit_id: String,
    authorization: String,
    expected_revision: u64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReceiptArgs {
    receipt_id: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ObserveArgs {
    query: String,
    #[serde(default)]
    id: Option<Id>,
    #[serde(default)]
    after: Option<String>,
    #[serde(default)]
    limit: Option<usize>,
    #[serde(default)]
    expected_revision: Option<u64>,
}
fn parse<T: DeserializeOwned>(value: Value) -> Result<T> {
    Ok(serde_json::from_value(value)?)
}
fn encode(value: &impl Serialize) -> Result<String> {
    Ok(serde_json::to_string(value)?)
}
fn metadata_page<T>(
    items: impl Iterator<Item = (String, T)>,
    after: Option<&String>,
    limit: usize,
    project: impl Fn(T) -> Value,
) -> Vec<(String, Value)> {
    items
        .filter(|(id, _)| after.is_none_or(|cursor| id > cursor))
        .take(limit + 1)
        .map(|(id, item)| (id, project(item)))
        .collect()
}
fn clock() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Serial lifecycle service. Execute on a host worker thread, not the UI/render thread.
/// State/receipt retention is bounded and in memory; no guarantees survive a restart.
pub struct Provider {
    host: Arc<dyn GraphHost>,
    registry: Arc<Registry>,
    policy: Policy,
    sessions: BTreeMap<String, Session>,
    receipts: BTreeMap<String, Value>,
    scheduler: Scheduler,
    now: Arc<dyn Fn() -> u64 + Send + Sync>,
    provider_id: String,
    changed: bool,
}
impl Provider {
    pub fn new(host: Arc<dyn GraphHost>, registry: Arc<Registry>, policy: Policy) -> Self {
        Self::with_clock(host, registry, policy, Arc::new(clock))
    }
    pub fn with_clock(
        host: Arc<dyn GraphHost>,
        registry: Arc<Registry>,
        policy: Policy,
        now: Arc<dyn Fn() -> u64 + Send + Sync>,
    ) -> Self {
        Self {
            host,
            registry,
            policy,
            sessions: BTreeMap::new(),
            receipts: BTreeMap::new(),
            scheduler: Scheduler::new(4, 128),
            now,
            provider_id: format!("urn:unge:session:{}", Id::new_v4()),
            changed: false,
        }
    }
    pub fn take_changed(&mut self) -> bool {
        std::mem::take(&mut self.changed)
    }
    pub fn manifest(&self) -> Value {
        let intent: Value =
            serde_json::from_str(include_str!("../spec/acx-node-graph-intent.schema.json"))
                .expect("embedded schema");
        let capability = |id: &str,
                          risk: &str,
                          scope: &str,
                          description: &str,
                          ja: &str,
                          zh: &str,
                          reversible: bool| {
            json!({
                "id":id,"version":"0.1.0","description":description,
                "inputSchema":if id==OBSERVE { json!({"type":"object","required":["query"],"properties":{"query":{"enum":["summary","definitions","nodes","node","edges","groups"]},"id":{"type":"string","format":"uuid"},"after":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":100},"expected_revision":{"type":"integer","minimum":0}},"additionalProperties":false}) } else { let mut schema=intent.clone(); schema["oneOf"]=json!([intent["oneOf"][if id==EDIT {0}else{1}].clone()]); schema },
                "outputSchema": if id==OBSERVE {json!({"type":"object","required":["documentId","revision","nodes","edges","groups"]})} else {json!({"oneOf":[{"type":"object","required":if id==EDIT {vec!["summary","documentHash"]}else{vec!["documentId","executionRevision","succeeded","reportHash","detailsOmitted"]}},{"type":"object","required":["error"]}]})},"bindings":[{"type":"other","profile":PROFILE,"framing":"json-lines","discoveryMethod":"discover","methods":["discover","observe","preflight","authorize","commit","execute","receipt","recover"]}],
                "risk":risk,"authority":{"approval":if id==OBSERVE {"none"}else{"policy"},"scopes":[scope]},
                "effects":if id==EDIT {vec!["graph-document-mutation"]}else if id==RUN {vec!["host-allowlisted-node-execution"]}else {vec![]},
                "economics":{"model":"free","currency":"USD","max":"0.00"},"evidence":{"receipt":if id==OBSERVE {"none"}else{"plain"}},
                "recovery":{"reversible":reversible,"condition":if reversible {"same document, latest unchanged revision, retained undo, unexpired grant"}else{"not supported"}},
                "extensions":{"org.unge.node-graph":{"profileVersion":"0.1.0","description":{"en":description,"ja":ja,"zh-CN":zh},"requestSchema":"embedded inputSchema","digestEncoding":"provider-json-utf8-v1","policy":{"edit":self.policy.allow_edit,"run":self.policy.allow_run,"createTypes":self.policy.create_types,"executeTypes":self.policy.execute_types},"limits":{"requestBytes":MAX_MESSAGE_BYTES,"operations":256,"pageItems":100,"sessions":self.policy.max_sessions,"nodes":self.policy.max_nodes,"runNodes":self.policy.max_run_nodes}}}
            })
        };
        json!({"acx":"0.1","provider":{"id":self.provider_id,"name":"UNGE Rust graph provider"},"capabilities":[
            capability(OBSERVE,"observational","graph:read","Inspect the graph and registered node definitions","グラフと登録ノード定義を照会","查询节点图和已注册的节点定义",false),
            capability(EDIT,"reversible","graph:edit","Edit a graph as one reversible transaction","グラフを取り消し可能な単一トランザクションで編集","以可撤销的单一事务编辑节点图",true),
            capability(RUN,"consequential","graph:run","Execute a revision-bound graph using explicitly allowed executors","明示的に許可した実行器で指定リビジョンのグラフを実行","使用明确允许的执行器运行指定版本的节点图",false)
        ]})
    }
    pub fn dispatch(&mut self, method: &str, params: Value) -> Result<Value> {
        if encode(&params)?.len() > MAX_MESSAGE_BYTES {
            return Err(AcxError::new("limit_exceeded", "request exceeds 256 KiB"));
        }
        let params = if params.is_null() { json!({}) } else { params };
        match method {
            "discover" => Ok(self.manifest()),
            "observe" => self.observe(parse(params)?),
            "preflight" => self.preflight(parse(params)?),
            "authorize" => self.authorize(parse(params)?),
            "commit" => self.commit(parse(params)?),
            "execute" => self.execute(parse(params)?),
            "receipt" => {
                let args: ReceiptArgs = parse(params)?;
                self.receipts
                    .get(&args.receipt_id)
                    .cloned()
                    .ok_or_else(|| AcxError::new("not_found", "unknown receipt"))
            }
            "recover" => self.recover(parse(params)?),
            _ => Err(AcxError::new("unknown_method", method)),
        }
    }
    fn observe(&self, args: ObserveArgs) -> Result<Value> {
        let snapshot = self.host.snapshot()?;
        if args
            .expected_revision
            .is_some_and(|r| r != snapshot.revision)
        {
            return Err(AcxError::new("revision_conflict", snapshot.revision));
        }
        let limit = args.limit.unwrap_or(50);
        if !(1..=100).contains(&limit) {
            return Err(AcxError::new("limit_exceeded", "page size must be 1..100"));
        }
        let doc = &snapshot.document;
        let mut result = snapshot.summary();
        if args.query == "summary" {
            return Ok(result);
        }
        if args.query == "node" {
            let id = args
                .id
                .ok_or_else(|| AcxError::new("invalid_request", "node query requires id"))?;
            let node = doc
                .graph()
                .nodes()
                .get(&id)
                .ok_or_else(|| AcxError::new("not_found", id))?;
            result["node"] = json!({"node":node,"rect":doc.placement().get(&id)});
        } else {
            let after = args.after.as_ref();
            let page = match args.query.as_str() {
                "definitions" => metadata_page(
                    self.registry.definitions().map(|d| (d.type_id.clone(), d)),
                    after,
                    limit,
                    |d| json!(d),
                ),
                "nodes" => metadata_page(
                    doc.graph().nodes().values().map(|n| (n.id.to_string(), n)),
                    after,
                    limit,
                    |n| json!({"node":n,"rect":doc.placement().get(&n.id)}),
                ),
                "edges" => metadata_page(
                    doc.graph().edges().values().map(|e| (e.id.to_string(), e)),
                    after,
                    limit,
                    |e| json!(e),
                ),
                "groups" => metadata_page(
                    doc.graph().groups().values().map(|g| (g.id.to_string(), g)),
                    after,
                    limit,
                    |g| json!(g),
                ),
                _ => {
                    return Err(AcxError::new(
                        "invalid_request",
                        "unknown observation query",
                    ));
                }
            };
            result["nextCursor"] = if page.len() > limit {
                json!(page[limit - 1].0)
            } else {
                Value::Null
            };
            result["items"] = Value::Array(
                page.into_iter()
                    .take(limit)
                    .map(|(_, value)| value)
                    .collect(),
            );
        }
        if encode(&result)?.len() > MAX_MESSAGE_BYTES / 2 {
            return Err(AcxError::new(
                "limit_exceeded",
                "metadata page too large; reduce limit or keep properties as resource references",
            ));
        }
        Ok(result)
    }
    fn require_policy(&self, input: &Intent, snapshot: &Snapshot) -> Result<()> {
        if snapshot.document.graph().nodes().len() > self.policy.max_nodes {
            return Err(AcxError::new(
                "limit_exceeded",
                "graph exceeds host node limit",
            ));
        }
        match input {
            Intent::Edit { .. } if !self.policy.allow_edit => Err(AcxError::new(
                "policy_denied",
                "graph:edit is not granted by the host",
            )),
            Intent::Run { .. } => {
                if !self.policy.allow_run {
                    return Err(AcxError::new(
                        "policy_denied",
                        "graph:run is not granted by the host",
                    ));
                }
                if snapshot.document.graph().nodes().len() > self.policy.max_run_nodes {
                    return Err(AcxError::new(
                        "limit_exceeded",
                        "graph exceeds execution node limit",
                    ));
                }
                for node in snapshot.document.graph().nodes().values() {
                    if !self.policy.execute_types.contains(&node.type_id)
                        || !self
                            .registry
                            .definition(&node.type_id)
                            .is_some_and(|d| d.pure)
                    {
                        return Err(AcxError::new(
                            "policy_denied",
                            format!("execution not allowed: {}", node.type_id),
                        ));
                    }
                }
                self.registry
                    .validate(snapshot.document.graph())
                    .map_err(|e| AcxError::new("invalid_graph", e))
            }
            _ => Ok(()),
        }
    }
    fn preflight(&mut self, args: PreflightArgs) -> Result<Value> {
        if self.sessions.len() >= self.policy.max_sessions {
            return Err(AcxError::new(
                "capacity_exceeded",
                "session retention is full; host must start a new provider session",
            ));
        }
        let snapshot = self.host.snapshot()?;
        let (document, revision) = args.input.target();
        check_snapshot(&snapshot, document, revision)?;
        self.require_policy(&args.input, &snapshot)?;
        let (command, preview) = match &args.input {
            Intent::Edit { operations, .. } => {
                let (command, preview) = compile_edit(
                    &snapshot.document,
                    operations,
                    &self.registry,
                    &self.policy.create_types,
                )?;
                if preview.graph().nodes().len() > self.policy.max_nodes
                    || encode(&command)?.len() > 4 * MAX_MESSAGE_BYTES
                {
                    return Err(AcxError::new(
                        "limit_exceeded",
                        "compiled edit exceeds host limits",
                    ));
                }
                (
                    Some(command),
                    json!({"nodes":preview.graph().nodes().len(),"edges":preview.graph().edges().len(),"documentHash":hash_json(&preview)?}),
                )
            }
            Intent::Run { .. } => (
                None,
                json!({"nodes":snapshot.document.graph().nodes().len(),"executionRevision":revision}),
            ),
        };
        let id = Id::new_v4().to_string();
        let input_json = encode(&args.input)?;
        // Decode the exact typed encoding: converting f32 directly through json!
        // expands it to f64 and can disagree with requestJson (e.g. 0.1).
        let normalized_input: Value = serde_json::from_str(&input_json)?;
        let reversible = matches!(args.input, Intent::Edit { .. });
        let expires_at = (self.now)()
            .checked_add(self.policy.ttl_seconds)
            .ok_or_else(|| AcxError::new("invalid_policy", "TTL overflow"))?;
        let mut preflight = json!({"preflightId":id,"provider":self.provider_id,"capability":args.input.capability(),"version":"0.1.0",
            "input":normalized_input,"requestJson":input_json,"requestHash":hash_bytes(input_json.as_bytes()),"documentHash":hash_json(&snapshot.document)?,
            "effects":if reversible {vec!["graph-document-mutation"]}else{vec!["host-allowlisted-node-execution"]},
            "cost":{"currency":"USD","estimated":"0.00","max":"0.00"},"approval":{"type":"policy","scope":if reversible {"graph:edit"}else{"graph:run"}},
            "recovery":{"reversible":reversible,"condition":"unchanged revision and retained undo","expiresAt":expires_at},"expiresAt":expires_at,"preview":preview});
        let preflight_json = encode(&preflight)?;
        preflight["preflightDigest"] = json!(hash_bytes(preflight_json.as_bytes()));
        preflight["preflightJson"] = json!(preflight_json);
        // The duplicated signed/hash material is bounded before retaining a session.
        if encode(&preflight)?.len() > MAX_MESSAGE_BYTES {
            return Err(AcxError::new(
                "limit_exceeded",
                "preflight exceeds 256 KiB; use a smaller edit",
            ));
        }
        self.sessions.insert(
            id,
            Session {
                preflight: preflight.clone(),
                input: args.input,
                command,
                authorization: None,
                commit: None,
                execution: None,
                recovery: None,
                started: false,
                after_revision: None,
            },
        );
        Ok(preflight)
    }
    fn bound(&self, id: &str, digest: &str) -> Result<&Session> {
        let session = self
            .sessions
            .get(id)
            .ok_or_else(|| AcxError::new("not_found", "unknown preflight"))?;
        if session.preflight["preflightDigest"] != digest {
            return Err(AcxError::new(
                "digest_mismatch",
                "preflight digest does not match",
            ));
        }
        self.unexpired(session)?;
        Ok(session)
    }
    fn unexpired(&self, session: &Session) -> Result<()> {
        if (self.now)() >= session.preflight["expiresAt"].as_u64().unwrap() {
            return Err(AcxError::new("expired", "preflight has expired"));
        }
        Ok(())
    }
    fn fresh(&self, session: &Session) -> Result<Snapshot> {
        let snapshot = self.host.snapshot()?;
        let (document, revision) = session.input.target();
        check_snapshot(&snapshot, document, revision)?;
        if hash_json(&snapshot.document)? != session.preflight["documentHash"] {
            return Err(AcxError::new(
                "revision_conflict",
                "document content changed",
            ));
        }
        self.require_policy(&session.input, &snapshot)?;
        Ok(snapshot)
    }
    fn authorize(&mut self, args: BoundArgs) -> Result<Value> {
        let session = self.bound(&args.preflight_id, &args.preflight_digest)?;
        self.fresh(session)?;
        let token = session
            .authorization
            .clone()
            .unwrap_or_else(|| format!("{}{}", Id::new_v4().simple(), Id::new_v4().simple()));
        let result = json!({"authorization":token,"provider":self.provider_id,"scope":session.preflight["approval"]["scope"],"expiresAt":session.preflight["expiresAt"]});
        self.sessions
            .get_mut(&args.preflight_id)
            .unwrap()
            .authorization = Some(token);
        Ok(result)
    }
    fn commit(&mut self, args: CommitArgs) -> Result<Value> {
        let session = self.bound(&args.preflight_id, &args.preflight_digest)?;
        if session.authorization.as_deref() != Some(&args.authorization) {
            return Err(AcxError::new(
                "unauthorized",
                "missing or unrelated authorization",
            ));
        }
        if hash_json(&args.input)? != session.preflight["requestHash"] {
            return Err(AcxError::new(
                "digest_mismatch",
                "input changed after preflight",
            ));
        }
        if session.commit.is_some() {
            return Err(AcxError::new(
                "already_committed",
                "preflight was already committed",
            ));
        }
        self.fresh(session)?;
        let id = Id::new_v4().to_string();
        self.sessions.get_mut(&args.preflight_id).unwrap().commit = Some(id.clone());
        Ok(json!({"commitId":id,"preflightId":args.preflight_id}))
    }
    fn session_for_commit(&self, id: &str) -> Result<String> {
        self.sessions
            .iter()
            .find(|(_, s)| s.commit.as_deref() == Some(id))
            .map(|(id, _)| id.clone())
            .ok_or_else(|| AcxError::new("unauthorized", "unknown commit"))
    }
    fn record(
        &mut self,
        preflight: &Value,
        result: Value,
        status: &str,
        recovery: Value,
    ) -> Result<Value> {
        let result_json = encode(&result)?;
        let receipt_id = Id::new_v4().to_string();
        let receipt = json!({"acx":"0.1","receiptId":receipt_id,"capability":preflight["capability"],"provider":self.provider_id,
            "status":status,"issuedAt":chrono::Utc::now().to_rfc3339(),"requestHash":preflight["requestHash"],"resultHash":hash_bytes(result_json.as_bytes()),
            "effects":preflight["effects"],"cost":{"currency":"USD","amount":"0.00"},"recovery":recovery});
        self.receipts.insert(receipt_id.clone(), receipt);
        Ok(json!({"result":result,"resultJson":result_json,"receiptId":receipt_id}))
    }
    fn execute(&mut self, args: ExecuteArgs) -> Result<Value> {
        let id = self.session_for_commit(&args.commit_id)?;
        let session = &self.sessions[&id];
        if let Some(result) = &session.execution {
            return Ok(result.clone());
        }
        self.unexpired(session)?;
        if session.started {
            return Err(AcxError::new(
                "execution_uncertain",
                "execution already started; do not retry effects",
            ));
        }
        let snapshot = self.fresh(session)?;
        let input = session.input.clone();
        let command = session.command.clone();
        let mut preflight = session.preflight.clone();
        let is_edit = command.is_some();
        self.sessions.get_mut(&id).unwrap().started = true;
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(
            || -> Result<(Value, bool, Option<u64>)> {
                match input {
                    Intent::Edit {
                        document_id,
                        expected_revision,
                        ..
                    } => {
                        let after =
                            self.host
                                .apply(document_id, expected_revision, command.unwrap())?;
                        self.changed = true;
                        Ok((
                            json!({"summary":after.summary(),"documentHash":hash_json(&after.document)?}),
                            true,
                            Some(after.revision),
                        ))
                    }
                    Intent::Run { .. } => {
                        let report = futures::executor::block_on(self.scheduler.run(
                            snapshot.document.graph(),
                            &self.registry,
                            Cancellation::default(),
                        ))
                        .map_err(|e| AcxError::new("execution_failed", e))?;
                        let success = report
                            .nodes
                            .values()
                            .all(|n| matches!(n.status, Status::Completed | Status::Cached));
                        let report_hash = hash_json(&report)?;
                        // Scalars and resource handles only. JSON/large strings remain in Rust.
                        let nodes: BTreeMap<_,_>=report.nodes.iter().map(|(id,n)| {
                        let outputs:BTreeMap<_,_>=n.outputs.iter().filter_map(|(name,value)| {
                            let safe=match value { unge_executor::Value::Json(_)=>false,unge_executor::Value::String(s)=>s.len()<=512,_=>true };
                            safe.then(||(name,json!(value)))
                        }).collect();
                        (*id,json!({"status":n.status,"outputs":outputs,"outputsHash":hash_json(&n.outputs).unwrap(),"error":n.error.as_ref().map(|e|e.chars().take(256).collect::<String>())}))
                    }).collect();
                        let mut result = json!({"documentId":snapshot.document.graph().id,"executionRevision":snapshot.revision,"succeeded":success,"reportHash":report_hash,"nodes":nodes,"detailsOmitted":false});
                        if encode(&result)?.len() > MAX_MESSAGE_BYTES / 4 {
                            result = json!({"documentId":snapshot.document.graph().id,"executionRevision":snapshot.revision,"succeeded":success,"reportHash":report_hash,"detailsOmitted":true});
                        }
                        Ok((result, success, None))
                    }
                }
            },
        ));
        let (result, status, after) = match outcome {
            Ok(Ok((result, success, after))) => {
                (result, if success { "succeeded" } else { "failed" }, after)
            }
            Ok(Err(error)) => (json!({"error":error}), "failed", None),
            Err(_) => (
                json!({"error":AcxError::new("execution_failed","host executor panicked; execution is not retried")}),
                "failed",
                None,
            ),
        };
        if is_edit && status == "failed" {
            preflight["effects"] = json!([]);
        }
        let recovery = if after.is_some() {
            preflight["recovery"].clone()
        } else {
            json!({"reversible":false})
        };
        let execution = self.record(&preflight, result, status, recovery)?;
        let session = self.sessions.get_mut(&id).unwrap();
        session.after_revision = after;
        session.execution = Some(execution.clone());
        Ok(execution)
    }
    fn recover(&mut self, args: RecoverArgs) -> Result<Value> {
        let id = self.session_for_commit(&args.commit_id)?;
        let session = &self.sessions[&id];
        if session.authorization.as_deref() != Some(&args.authorization) {
            return Err(AcxError::new(
                "unauthorized",
                "missing or unrelated recovery authorization",
            ));
        }
        if let Some(result) = &session.recovery {
            return Ok(result.clone());
        }
        self.unexpired(session)?;
        if session.after_revision != Some(args.expected_revision) {
            return Err(AcxError::new(
                "recovery_unavailable",
                "only a successful edit at its execution revision can be recovered",
            ));
        }
        let document = session.input.target().0;
        let mut preflight = session.preflight.clone();
        let after = self.host.undo(document, args.expected_revision)?;
        self.changed = true;
        preflight["effects"] = json!(["graph-edit-rollback"]);
        let recovered=self.record(&preflight,json!({"recoveredCommitId":args.commit_id,"summary":after.summary(),"documentHash":hash_json(&after.document)?}),"succeeded",json!({"reversible":false,"state":"recovered"}))?;
        self.sessions.get_mut(&id).unwrap().recovery = Some(recovered.clone());
        Ok(recovered)
    }
}
