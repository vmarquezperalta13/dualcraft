# Web ⇄ mobile mapping (Next.js ⇄ Flutter)

Used by `dualcraft:convert` in the **adapt** step. Same content and behaviour; native patterns on each side. When a row doesn't fit the screen, prefer the platform's own guidelines (Material 3 / Human Interface Guidelines; web: responsive + accessible HTML) and note the choice in the screen spec.

## Navigation & structure
| Web (Next.js) | Mobile (Flutter) |
|---|---|
| Top nav / sidebar with 3–7 sections | `NavigationBar` (bottom) for 3–5 top destinations; more → drawer or "Más" tab |
| URL route `/matches/[id]` | named route `/matches/:id` (go_router) + deep link / App Link for the same path |
| Breadcrumbs | back button in `AppBar` (stack navigation) |
| Query params for filters/sort (`?sort=date`) | state in the screen's controller; persist if the user expects it |
| `layout.tsx` shared chrome | shell route / scaffold with persistent bottom nav |
| `loading.tsx` / Suspense | loading state in the screen (skeleton or progress) |
| `error.tsx` / `not-found.tsx` | error state widget with retry; "not found" screen |
| New tab / external link | `url_launcher` (in-app browser for content, external for others) |
| Footer links (legal, about) | Settings/Profile → "Acerca de", legal pages |

## Layout
| Web | Mobile |
|---|---|
| Multi-column / grid on wide screens | single column; grid of 2 for cards/media |
| Data table | list of cards / `ListTile`s with the 2–3 key fields; detail on tap |
| Hover states, tooltips | press states; long-press or info icon for extra info |
| Sticky header | `SliverAppBar` (collapsing) |
| Modal dialog | dialog for confirmations; `showModalBottomSheet` for choices/forms |
| Dropdown menu | bottom sheet with options, or `DropdownMenu` for short lists |
| Side panel (detail beside list) | push to detail screen (list-detail on tablets) |
| Infinite scroll / pagination buttons | infinite scroll with `ListView.builder` + loading footer |
| Max content width ~1200px centered | full width with 16px gutters; respect safe areas |

## Input & interaction
| Web | Mobile |
|---|---|
| Form with labels left / inline validation | stacked fields, keyboard type per field (`TextInputType.emailAddress`), `textInputAction` next/done |
| `<input type="date">` | `showDatePicker` |
| File input / drag & drop | `image_picker` / `file_picker` (camera option) |
| Copy to clipboard button | same + haptic feedback, snackbar |
| Keyboard shortcuts | none — make sure every action has a visible control |
| Right-click menu | long-press / overflow menu (⋮) |
| Pull data on focus/visibility | pull-to-refresh (`RefreshIndicator`) + refresh on resume |
| `navigator.share` / share links | `share_plus` |

## Platform capabilities (backend/platform decisions — ask the user)
| Web | Mobile |
|---|---|
| Stripe / web checkout | in-app purchases (store rules: digital goods inside apps must use IAP); physical goods/services may use Stripe |
| Web Push (service worker) | FCM push (`firebase_messaging`), permission prompt in context |
| Cookies/session | Firebase Auth persistence; secure storage for other tokens |
| `localStorage` | `shared_preferences` (non-sensitive) / `flutter_secure_storage` (sensitive) |
| Geolocation API | `geolocator` with permission rationale |
| Camera via `<input capture>` / getUserMedia | `camera` / `image_picker` / `mobile_scanner` (QR) |
| Offline: limited (service worker) | Firestore offline persistence; design for flaky networks |
| SEO, Open Graph, sitemap | store listing (ASO), deep links; no SEO inside the app |
| Server components / route handlers / server actions | **no server in the app** → Firebase directly (with rules) or Cloud Functions / an HTTP API — decided per piece with the user |

## Feedback & states
| Web | Mobile |
|---|---|
| Toast | `SnackBar` |
| Inline banner | `MaterialBanner` or inline card |
| Spinner | `CircularProgressIndicator` / skeletons |
| Empty state illustration + CTA | same, sized for mobile |
| Confirmation `confirm()` | `AlertDialog` with clear verbs ("Eliminar", "Cancelar") |

## Text & media
- Long-form text (articles, legal): mobile renders it in a scrollable screen or opens the web page.
- Images: web `next/image` with `sizes`; mobile `Image.network` + cache (`cached_network_image` if the project uses it), same aspect ratios.
- Video/embeds: platform players; YouTube embeds → `youtube_player_flutter` or open externally.
