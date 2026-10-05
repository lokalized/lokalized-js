# Building and publishing the API reference

The JavaScript reference uses TypeDoc against all nine public declaration entry
points from `package.json`. The declarations are emitted from checked source
JSDoc immediately before generation. Supporting definitions referenced by
public signatures are documented separately; that group is not an import path.
Generation fails on unresolved symbol links and omitted referenced types.
Generation copies the declarations into its ignored build directory and adds
TypeDoc's `@interface` presentation tag to the derived `Strings` alias. The
factory links to that shape, whose methods are navigable. The alias's actual
`ReturnType` expression and the shipped declarations remain unchanged.

## Development reference

From the repository root, with Node 20 or later:

```sh
npm ci
npm run docs:api
```

Serve `.build/api-documentation/site` with a static file server and open its
`index.html`. The development reference lives under `development/`; every page
identifies it as development and carries the package version. The package version
does not imply that uncommitted or unreleased source has been published to npm.

The output includes `api.json` for machine-readable reference data and
`reference-build.json` with the source revision, dirty state, input fingerprint,
TypeDoc version, entry-point inventory, and documentation counts. Generated
output is ignored by Git and excluded from the npm package. TypeDoc is a pinned
development dependency; runtime dependencies remain zero.

## Release references

From a clean checkout whose HEAD already has the intended semantic-version tag,
run `npm run docs:api -- --release VERSION`, replacing `VERSION` with the exact
version from `package.json`. Tags may be `VERSION` or `vVERSION`. The generator
refuses dirty source, a mismatched package version, or a missing matching tag.
It does not create tags, commits, GitHub releases, or npm publications.

The release output lives under `VERSION/` rather than overwriting the development
reference. Existing editions in the same output tree are retained and listed
on its root index. Release candidates receive their own versioned directories.

## Hosting at jsdoc.lokalized.com

The `JavaScript API documentation` workflow builds on pushes and pull requests
and can be dispatched manually. Version-tag pushes build release references;
other runs build development references. Download the `javascript-api-reference`
artifact to obtain the complete static `site/` contents. The workflow has only
read permissions and does not deploy.

Publish those contents to a static host with the custom domain
`jsdoc.lokalized.com`, configure its DNS as instructed by the host, and enable
HTTPS. JavaScript documentation needs no application server or SPA fallback.
Keep the edition directory names unchanged: relative navigation, assets, and
search resolve within each edition.

When updating an existing site, retain prior release directories. Restore them
into the local `site/` output before rebuilding to regenerate the edition index,
or merge the newly built edition into the hosting site's existing tree and
update its root index. A fresh CI artifact contains only the edition built by
that run, so replacing the entire deployed tree would remove older references.

Before enabling the main website's API link, verify the hosted root, a function
page, a type page, and search. The website reference label is **JSDoc**, even
though TypeDoc generates the HTML.
