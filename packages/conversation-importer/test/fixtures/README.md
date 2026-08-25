# Provider Export Fixtures

These fixtures contain synthetic, non-user data and exercise only the fields consumed by KOMYAKU's versioned adapters. They are representative compatibility fixtures, not claims that provider export schemas are public or stable.

- `chatgpt-conversations.json`: mapping graph with two assistant branches.
- `claude-conversations.json`: linear `chat_messages` export.
- `gemini-conversations.json`: structured conversation/entry export.
- `gemini-my-activity.json`: flat Google Takeout My Activity entry with safe HTML.

When a provider changes its export, add a redacted synthetic reproduction as a new fixture before changing an adapter. Never commit a real user export. Preserve raw bytes in the immutable archive, bump the relevant parser version, and document whether migration or re-import is required.
