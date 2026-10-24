# Reference implementations consulted, 2026-10-24

- `yt-dlp/yt_dlp/extractor/instagram.py` (yt-dlp, Unlicense): `_extract_product_media` traverses an individual media record's `video_versions` and `video_dash_manifest`; `_extract_product` maps each `carousel_media` child separately. https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/instagram.py
- `cobalt/api/src/processing/services/instagram.js` (Cobalt, AGPL-3.0): `extractNewPost` selects highest-res `video_versions` from each separate `carousel_media` element; `extractOldPost` uses each child `video_url`. https://github.com/imputnet/cobalt/blob/main/api/src/processing/services/instagram.js
- `flurrux/insta-loader` (Chrome extension): explicitly warns its video downloads lack soundtrack when Instagram splits streams; not a reference for correct A/V pairing. https://github.com/flurrux/insta-loader

**Engineering rule implemented in RemiInstagramDownloader:** a media download must be grounded in the individual selected media record, not in shared post ID, video playback time, or a browser-tab-wide list of CDN requests. A download with audio must use the original MP4's embedded audio, or an audio representation from the *same selected media record's* DASH manifest as the video representation. Ambiguous records fail rather than downloading unrelated media.

We studied behavior and architecture only. No source code from these repositories is copied into this extension.

### Exact-media lookup added

The extension now attempts the same authenticated media-info lookup that
`yt-dlp` uses for logged-in Instagram sessions: derive the numeric post PK
from the selected shortcode and request `/api/v1/media/{pk}/info/` from the
already-open Instagram page. It validates the returned root against that
shortcode and constructs distinct records for `carousel_media` children,
with their own `video_versions` and `video_dash_manifest`.

For an actual single-item Reel, that server-confirmed record is enough to
select the matching stream even when the visible `<video>` has a `blob:` URL
and its poster differs from `image_versions2`. The same exception is **not**
used for carousels. Request timing and reused sound-library audio are never
accepted as a binding. Account- or region-specific API restrictions can still
prevent resolution; this browser-only method is not guaranteed on every post.

References:
- https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/instagram.py
- https://github.com/Papan1a/instagram-media-saver/blob/master/docs/architecture.md
