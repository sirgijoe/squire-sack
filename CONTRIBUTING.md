# Contributing to Squire

Thanks for wanting to help. Squire is free software under the GPL, made to make people's lives a little easier.

## Ways to help

- **Report a bug or suggest an idea:** [open an issue](https://github.com/sirgijoe/squire-sack/issues/new/choose). Screenshots and steps to reproduce help a lot.
- **Improve the docs:** typo fixes and clearer wording are always welcome.
- **Write code:** for anything bigger than a small fix, open an issue first so we can agree on the approach before you spend time on it.

## Working on the code

- Run the web app with `npm run serve` (or `python3 -m http.server 8080 -d src`) and open http://localhost:8080. There's no build step.
- Plain HTML, CSS and JavaScript with no dependencies and no build step. Please keep it that way, and don't add a framework or npm runtime packages.
- Before sending a pull request, run the tests: `npm test` (Node 18+) and, if you touched `src-tauri/`, `cd src-tauri && cargo test`.
- Keep changes focused, one fix or feature per pull request, and describe what you changed and how you tested it.
- Write messages and text in the app in plain, friendly language. Many users aren't technical.

## License

By contributing, you agree your work is released under the same license as the rest of Squire (see [LICENSE](LICENSE)).

Please follow the [code of conduct](CODE_OF_CONDUCT.md).
