# Arcs Cloud Server

## Basic Usage

Execute the following commands to start the Arcs cloud server

```
cd ..
./tools/sigh
cd server
npm build
npm start
```

## Server Layout / Configuration

By default the server runs on port 8080.  You can override this by passing in the base port like this:

```
  npm start -- 8000
```

The server exposes a `/db` endpoint mapped to an in-memory pouchdb instance.  A basic `index.html`
page is provided with links to various functionality.

## Development

### Basics

You will find the node source and tests in the `src` and `test`
directories.  The following are common commands that you will want to use:

- `npm run build` builds code, runs tests and then lints.
- `npm test` builds code, runs tests and then lints.
- `npm run lint` just lints.
- `npm run lint:fix` lints and fixes.
- `npm run prettier` formats source code.
- `npm run watch` starts a server and runs test as you make changes.

For many of these commands you can pass optional arguments.  For
example you can also pass the `--fix` argument to lint by executing
the following command

```
  npm run lint -- --fix
```

### Debugging

Use the `DEBUG` environment variable to add more debugging output.
Use `*` for all messages or a substring that matches the messages you
want to see.

```
   DEBUG=* npm start
 ```
