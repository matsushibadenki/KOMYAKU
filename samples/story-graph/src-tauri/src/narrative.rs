//! Explicit author declarations, never prose-inferred facts. State is evaluated
//! in path order and belongs to the Rust document, including Undo and Archives.
use super::*;
use std::collections::{BTreeMap, BTreeSet};
pub const EXTENSION: &str = "komyaku.story.narrative";
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Declarations {
    pub facts: Vec<Fact>,
    pub events: Vec<KnowledgeEvent>,
    pub foreshadows: Vec<Foreshadow>,
    pub tests: Vec<NarrativeTest>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub entities: Vec<state_rules::Entity>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rules: Vec<state_rules::Rule>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub assertions: Vec<state_rules::Assertion>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Fact {
    pub id: Id,
    pub name: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KnowledgeEvent {
    pub id: Id,
    pub scene: Id,
    pub character: Id,
    pub fact: Id,
    pub operation: Operation,
}
#[derive(Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Operation {
    Learn,
    Forget,
    Require,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Foreshadow {
    pub id: Id,
    pub source: Id,
    pub target: Id,
    pub fact: Id,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NarrativeTest {
    pub id: Id,
    pub path: Id,
    pub scene: Id,
    pub character: Id,
    pub fact: Id,
    pub phase: Phase,
    pub expected: bool,
}
#[derive(Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Before,
    After,
}
pub fn declarations(document: &Document) -> std::result::Result<Declarations, String> {
    document
        .extensions
        .get(EXTENSION)
        .map(|value| serde_json::from_value(value.clone()).map_err(|_| "narrative_invalid".into()))
        .unwrap_or_else(|| Ok(Declarations::default()))
}
pub fn validate(document: &Document, value: &Declarations) -> std::result::Result<(), String> {
    if value.facts.len() > 256
        || value.events.len() > 2048
        || value.foreshadows.len() > 1024
        || value.tests.len() > 256
    {
        return Err("limit_exceeded".into());
    }
    let mut ids: BTreeSet<_> = document
        .graph()
        .nodes()
        .keys()
        .chain(document.graph().edges().keys())
        .chain(document.graph().groups().keys())
        .copied()
        .collect();
    let mut names = BTreeSet::new();
    let mut facts = BTreeSet::new();
    for fact in &value.facts {
        if !ids.insert(fact.id)
            || !facts.insert(fact.id)
            || fact.name.trim().is_empty()
            || fact.name != fact.name.trim()
            || fact.name.chars().count() > 200
            || fact.name.chars().any(char::is_control)
            || !names.insert(fact.name.clone())
            || document.graph().nodes().contains_key(&fact.id)
        {
            return Err("narrative_invalid".into());
        }
    }
    let character = |id: &Id| {
        document
            .graph()
            .nodes()
            .get(id)
            .is_some_and(|n| n.type_id == domain::CHARACTER)
    };
    let scene = |id: &Id| {
        document
            .graph()
            .nodes()
            .get(id)
            .is_some_and(|n| n.type_id == domain::SCENE)
    };
    let mut per_scene = BTreeMap::<Id, usize>::new();
    let mut event_keys = BTreeSet::new();
    for event in &value.events {
        let count = per_scene.entry(event.scene).or_default();
        *count += 1;
        if *count > 100
            || !ids.insert(event.id)
            || !scene(&event.scene)
            || !character(&event.character)
            || !facts.contains(&event.fact)
            || !event_keys.insert((
                event.scene,
                event.character,
                event.fact,
                event.operation as u8,
            ))
        {
            return Err("narrative_invalid".into());
        }
    }
    let paths = paths::definitions(document)?;
    let mut links = BTreeSet::new();
    for link in &value.foreshadows {
        if !ids.insert(link.id)
            || !scene(&link.source)
            || !scene(&link.target)
            || link.source == link.target
            || !facts.contains(&link.fact)
            || !links.insert((link.source, link.target, link.fact))
        {
            return Err("narrative_invalid".into());
        }
    }
    for test in &value.tests {
        if !ids.insert(test.id)
            || !scene(&test.scene)
            || !character(&test.character)
            || !facts.contains(&test.fact)
            || !paths
                .iter()
                .any(|p| p.id == test.path && p.scenes.contains(&test.scene))
        {
            return Err("narrative_invalid".into());
        }
    }
    state_rules::validate(document, value, &mut ids)?;
    Ok(())
}
pub fn command(document: &Document, value: Declarations) -> std::result::Result<Command, String> {
    validate(document, &value)?;
    Ok(Command::SetDocumentExtension {
        key: EXTENSION.into(),
        value: Some(serde_json::to_value(value).map_err(|_| "narrative_invalid")?),
    })
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub revision: u64,
    pub declarations: Declarations,
    pub paths: Vec<PathReport>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathReport {
    pub path: Id,
    pub issues: Vec<Issue>,
    pub tests: Vec<TestResult>,
    pub final_knowledge: BTreeMap<Id, BTreeSet<Id>>,
    pub state: state_rules::Evaluation,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub code: &'static str,
    pub scene: Id,
    pub character: Option<Id>,
    pub fact: Id,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub id: Id,
    pub passed: bool,
    pub actual: bool,
}
pub fn report(document: &Document, revision: u64) -> std::result::Result<Report, String> {
    let declarations = declarations(document)?;
    validate(document, &declarations)?;
    let mut results = Vec::new();
    for path in paths::definitions(document)? {
        let mut knowledge: BTreeMap<Id, BTreeSet<Id>> = document
            .graph()
            .nodes()
            .values()
            .filter(|n| n.type_id == domain::CHARACTER)
            .map(|n| (n.id, BTreeSet::new()))
            .collect();
        let mut issues = Vec::new();
        let mut tests = Vec::new();
        for scene in &path.scenes {
            let check_tests = |phase: Phase,
                               knowledge: &BTreeMap<Id, BTreeSet<Id>>,
                               tests: &mut Vec<TestResult>| {
                for test in declarations
                    .tests
                    .iter()
                    .filter(|t| t.path == path.id && t.scene == *scene && t.phase == phase)
                {
                    let actual = knowledge[&test.character].contains(&test.fact);
                    tests.push(TestResult {
                        id: test.id,
                        passed: actual == test.expected,
                        actual,
                    });
                }
            };
            check_tests(Phase::Before, &knowledge, &mut tests);
            // All preconditions see the incoming state, even if another declaration at
            // the same scene teaches the fact. Effects follow in author-specified order.
            for event in declarations
                .events
                .iter()
                .filter(|e| e.scene == *scene && e.operation == Operation::Require)
            {
                if !knowledge[&event.character].contains(&event.fact) {
                    issues.push(Issue {
                        code: "knowledge_missing",
                        scene: *scene,
                        character: Some(event.character),
                        fact: event.fact,
                    });
                }
            }
            for event in declarations.events.iter().filter(|e| e.scene == *scene) {
                let state = knowledge
                    .get_mut(&event.character)
                    .expect("validated character");
                match event.operation {
                    Operation::Learn => {
                        state.insert(event.fact);
                    }
                    Operation::Forget => {
                        state.remove(&event.fact);
                    }
                    Operation::Require => {}
                }
            }
            check_tests(Phase::After, &knowledge, &mut tests);
        }
        for link in &declarations.foreshadows {
            if let Some(source) = path.scenes.iter().position(|id| *id == link.source)
                && path
                    .scenes
                    .iter()
                    .position(|id| *id == link.target)
                    .is_none_or(|target| target <= source)
            {
                issues.push(Issue {
                    code: "foreshadow_unresolved",
                    scene: link.source,
                    character: None,
                    fact: link.fact,
                });
            }
        }
        results.push(PathReport {
            path: path.id,
            issues,
            tests,
            final_knowledge: knowledge,
            state: state_rules::evaluate(&declarations, &path.scenes, path.id),
        });
    }
    Ok(Report {
        revision,
        declarations,
        paths: results,
    })
}
/// The same declarations are encoded as shared Entity state / conditions /
/// effects / semantic edges, enabling independent reference-engine evaluation.
pub fn apply_shared(document: &Document, graph: &mut Value) -> std::result::Result<(), String> {
    let value = declarations(document)?;
    validate(document, &value)?;
    if value.facts.is_empty()
        && value.events.is_empty()
        && value.foreshadows.is_empty()
        && value.tests.is_empty()
        && value.entities.is_empty()
        && value.rules.is_empty()
        && value.assertions.is_empty()
    {
        return Ok(());
    }
    for entity in graph["entities"]
        .as_array_mut()
        .ok_or("narrative_invalid")?
    {
        entity["initialState"] = json!({"knowledge":[]});
    }
    graph["entities"].as_array_mut().ok_or("narrative_invalid")?.extend(value.facts.iter().map(|fact|json!({"id":fact.id,"type":"fact","name":fact.name,"initialState":{},"metadata":{},"extensions":{}})));
    for node in graph["nodes"].as_array_mut().ok_or("narrative_invalid")? {
        let id = node["id"].as_str().ok_or("narrative_invalid")?;
        let events: Vec<_> = value
            .events
            .iter()
            .filter(|e| e.scene.to_string() == id)
            .collect();
        node["preconditions"]=json!(events.iter().filter(|e|e.operation==Operation::Require).map(|e|json!({"entityId":e.character,"key":"knowledge","operator":"contains","value":e.fact})).collect::<Vec<_>>());
        node["effects"]=json!(events.iter().filter(|e|e.operation!=Operation::Require).map(|e|json!({"entityId":e.character,"key":"knowledge","operation":if e.operation==Operation::Learn{"add"}else{"remove"},"value":e.fact})).collect::<Vec<_>>());
    }
    state_rules::apply_shared(&value, graph)?;
    // Multiple facts may share a scene pair. The shared contract allows one edge
    // per type/pair; its extension retains all author declarations on that pair.
    let mut links = BTreeMap::<(Id, Id), Vec<&Foreshadow>>::new();
    for link in &value.foreshadows {
        links
            .entry((link.source, link.target))
            .or_default()
            .push(link);
    }
    for ((from, to), links) in links {
        graph["edges"].as_array_mut().ok_or("narrative_invalid")?.push(json!({"id":links[0].id,"from":from,"to":to,"type":"foreshadows","label":null,"extensions":{"komyaku.foreshadow":links}}));
    }
    Ok(())
}
#[tauri::command]
pub fn narrative_report(
    window: tauri::WebviewWindow,
    host: tauri::State<Host>,
) -> std::result::Result<Report, String> {
    allowed(&window)?;
    host.engine
        .read_document(|document, summary| report(document, summary.revision))
        .map_err(|e| e.code)?
}
#[tauri::command]
pub fn narrative_knowledge(
    window: tauri::WebviewWindow,
    host: tauri::State<Host>,
    path: Id,
    scene: Id,
    character: Id,
    fact: Id,
    phase: Phase,
) -> std::result::Result<bool, String> {
    allowed(&window)?;
    host.engine
        .read_document(|document, _| {
            let declarations = declarations(document)?;
            validate(document, &declarations)?;
            if !declarations.facts.iter().any(|f| f.id == fact)
                || document
                    .graph()
                    .nodes()
                    .get(&character)
                    .is_none_or(|n| n.type_id != domain::CHARACTER)
            {
                return Err("narrative_invalid".into());
            }
            let paths = paths::definitions(document)?;
            let selected = paths.iter().find(|p| p.id == path).ok_or("invalid_path")?;
            if !selected.scenes.contains(&scene) {
                return Err("narrative_invalid".into());
            }
            let mut knowledge = BTreeSet::new();
            for id in &selected.scenes {
                if *id == scene && phase == Phase::Before {
                    return Ok(knowledge.contains(&fact));
                }
                for event in declarations
                    .events
                    .iter()
                    .filter(|e| e.scene == *id && e.character == character)
                {
                    match event.operation {
                        Operation::Learn => {
                            knowledge.insert(event.fact);
                        }
                        Operation::Forget => {
                            knowledge.remove(&event.fact);
                        }
                        Operation::Require => {}
                    }
                }
                if *id == scene {
                    return Ok(knowledge.contains(&fact));
                }
            }
            Err("narrative_invalid".into())
        })
        .map_err(|e| e.code)?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "writes cross-engine semantic contract fixture"]
    fn narrative_fixture() {
        let registry = domain::registry();
        let document = domain::initial_document(&registry);
        let paths = paths::definitions(&document).unwrap();
        let character = document
            .graph()
            .nodes()
            .values()
            .find(|n| n.type_id == domain::CHARACTER)
            .unwrap()
            .id;
        let fact = Id::new_v4();
        let declarations = Declarations {
            facts: vec![Fact {
                id: fact,
                name: "秘密".into(),
            }],
            events: vec![
                KnowledgeEvent {
                    id: Id::new_v4(),
                    scene: paths[0].scenes[1],
                    character,
                    fact,
                    operation: Operation::Learn,
                },
                KnowledgeEvent {
                    id: Id::new_v4(),
                    scene: paths[0].scenes[2],
                    character,
                    fact,
                    operation: Operation::Require,
                },
            ],
            entities: vec![],
            rules: vec![],
            assertions: vec![],
            foreshadows: vec![],
            tests: vec![NarrativeTest {
                id: Id::new_v4(),
                path: paths[0].id,
                scene: paths[0].scenes[2],
                character,
                fact,
                phase: Phase::Before,
                expected: true,
            }],
        };
        let mut editor = Editor::new(document.clone(), 10).unwrap();
        editor
            .execute(command(&document, declarations).unwrap())
            .unwrap();
        let value = json!({"workspace":super::super::shared_workspace::project(editor.document()).unwrap(),"report":report(editor.document(),1).unwrap()});
        std::fs::write(
            "/private/tmp/komyaku-narrative-fixture.json",
            serde_json::to_vec(&value).unwrap(),
        )
        .unwrap();
    }
    #[test]
    fn explicit_knowledge_is_path_specific_preconditions_precede_effects_and_undo_is_atomic() {
        let registry = domain::registry();
        let document = domain::initial_document(&registry);
        let paths = paths::definitions(&document).unwrap();
        let character = document
            .graph()
            .nodes()
            .values()
            .find(|n| n.type_id == domain::CHARACTER)
            .unwrap()
            .id;
        let fact = Id::new_v4();
        let test = Id::new_v4();
        let value = Declarations {
            entities: vec![],
            rules: vec![],
            assertions: vec![],
            facts: vec![Fact {
                id: fact,
                name: "手紙の秘密".into(),
            }],
            events: vec![
                KnowledgeEvent {
                    id: Id::new_v4(),
                    scene: paths[0].scenes[1],
                    character,
                    fact,
                    operation: Operation::Learn,
                },
                KnowledgeEvent {
                    id: Id::new_v4(),
                    scene: paths[0].scenes[1],
                    character,
                    fact,
                    operation: Operation::Require,
                },
            ],
            tests: vec![NarrativeTest {
                id: test,
                path: paths[0].id,
                scene: paths[0].scenes[1],
                character,
                fact,
                phase: Phase::After,
                expected: true,
            }],
            foreshadows: vec![Foreshadow {
                id: Id::new_v4(),
                source: paths[0].scenes[1],
                target: paths[0].scenes[0],
                fact,
            }],
        };
        let mut editor = Editor::new(document.clone(), 10)
            .unwrap()
            .with_validator(Arc::new(domain::Validator(registry)))
            .unwrap();
        editor
            .execute(command(&document, value.clone()).unwrap())
            .unwrap();
        let result = report(editor.document(), 1).unwrap();
        assert_eq!(result.paths[0].issues.len(), 2);
        assert!(result.paths[0].tests[0].passed);
        assert!(result.paths[0].final_knowledge[&character].contains(&fact));
        assert!(!result.paths[1].final_knowledge[&character].contains(&fact));
        let mut invalid = value;
        invalid.tests[0].character = Id::new_v4();
        assert!(command(editor.document(), invalid).is_err());
        editor.undo().unwrap();
        assert_eq!(editor.document().extensions, document.extensions);
    }
}
