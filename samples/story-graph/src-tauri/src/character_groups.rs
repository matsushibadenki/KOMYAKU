//! Character groups are document-owned, reversible membership sets.
use super::*;
use std::collections::BTreeSet;
pub fn command(
    document: &Document,
    id: Option<Id>,
    label: String,
    nodes: Vec<Id>,
    remove: bool,
) -> std::result::Result<Command, String> {
    let id = id.unwrap_or_else(Id::new_v4);
    if remove {
        if !document.graph().groups().contains_key(&id) {
            return Err("invalid_command".into());
        }
        return Ok(Command::SetGroup { id, group: None });
    }
    if label.trim().is_empty()
        || label.chars().count() > 80
        || label.chars().any(char::is_control)
        || nodes.is_empty()
        || nodes.len() > 256
        || nodes.iter().copied().collect::<BTreeSet<_>>().len() != nodes.len()
        || nodes.iter().any(|id| {
            document
                .graph()
                .nodes()
                .get(id)
                .is_none_or(|n| n.type_id != domain::CHARACTER)
        })
        || (!document.graph().groups().contains_key(&id) && document.graph().groups().len() >= 32)
    {
        return Err("invalid_command".into());
    }
    Ok(Command::SetGroup {
        id,
        group: Some(unge_core::Group {
            id,
            label: label.trim().into(),
            nodes: nodes.into_iter().collect(),
        }),
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn groups_validate_members_and_undo_without_touching_connections() {
        let registry = domain::registry();
        let document = domain::initial_document(&registry);
        let characters = document
            .graph()
            .nodes()
            .values()
            .filter(|n| n.type_id == domain::CHARACTER)
            .map(|n| n.id)
            .collect::<Vec<_>>();
        let mut editor = Editor::new(document.clone(), 8).unwrap();
        editor
            .execute(
                command(
                    &document,
                    None,
                    "家族 / Family".into(),
                    characters.clone(),
                    false,
                )
                .unwrap(),
            )
            .unwrap();
        assert_eq!(editor.document().graph().groups().len(), 1);
        assert_eq!(editor.document().graph().edges(), document.graph().edges());
        editor.undo().unwrap();
        assert_eq!(editor.document(), &document);
        assert!(command(&document, None, "Bad".into(), vec![Id::new_v4()], false).is_err());
        assert!(
            command(
                &document,
                None,
                "Bad".into(),
                vec![characters[0], characters[0]],
                false
            )
            .is_err()
        );
    }
}
