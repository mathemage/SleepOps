# GitHub Copilot Instructions

## Strategy

1. Write plan with success criteria for each phase to be checked off. Include project scaffolding, including .gitignore, and rigorous unit testing.
2. Execute the plan ensuring all criteria are met
3. Carry out extensive integration testing with Playwright or similar, fixing defects
4. Only complete when the MVP is finished and tested, with the server running and ready for the user

## Coding standards

1. Use latest versions of libraries and idiomatic approaches as of today
2. Keep it simple - NEVER over-engineer, ALWAYS simplify, NO unnecessary defensive programming. No extra features - focus on simplicity.
3. Be concise. Keep README minimal. IMPORTANT: no emojis ever

## Git and GitHub

- For every task, first create a new Issue, then create the related branch, and finally open the related PR.
- Use best practices for commit messages. Every commit message should follow this regex:
  `^(?:fix|chore|docs|feat|refactor|style|test)(?:\(.+\)): [A-Z].+(?:\s#\d+)?$`
- Always use one of the commit type keywords (`fix`, `chore`, `docs`, `feat`, `refactor`, `style`, `test`) with an explicit scope in the `type(scope): message` format, optionally followed by ` #<issue>` (for example, `feat(api): Add new endpoint` or `feat(api): Add new endpoint #123`).
