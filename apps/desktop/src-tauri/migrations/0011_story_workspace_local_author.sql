-- Local profile attribution is allocated by Rust inside the history transaction.
CREATE TABLE IF NOT EXISTS story_workspace_local_author (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    author_id TEXT NOT NULL CHECK(length(author_id) = 36)
);
