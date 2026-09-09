# xmldom 0.9 compatibility

Mammoth 1.12.1 requests xmldom 0.8.x. We override it to 0.9.12 for
the XML parser security fixes. The patch switches Mammoth's parser callback
from the deprecated `errorHandler` to `onError` and supplies the XML MIME
type required by xmldom 0.9. Without both changes, valid DOCX uploads lose
their extracted text.

Mammoth is pinned to the patched version. Remove the patch and revisit the
override when upgrading to a Mammoth release that supports xmldom 0.9.

electron-builder also uses xmldom through plist 3.1.0 to read macOS metadata.
Its patch supplies the same required XML MIME type. The plist override pins
that patch target; newer plist releases use an ESM-only API that is incompatible
with the packaging dependency's CommonJS `require`. Revisit this patch and pin
when upgrading electron-builder's plist integration.

`postinstall` applies the patch during normal installation. `pretest` and
`prebuild` also apply it because CI and release packaging install with
`npm ci --ignore-scripts`. Patch failures stop these commands.
