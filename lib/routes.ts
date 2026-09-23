// Public surface: the owner's selected work. Phase 1 is single-user, so the
// owner handle is pinned here; when multi-user lands this becomes
// `/${username}/selected_work`.
export const OWNER_HANDLE = "misha.buloy";
export const SELECTED_WORK_PATH = `/${OWNER_HANDLE}/selected_work`;

// The surface's previous address. Links copied before the rename still land:
// app/misha.buloy/taste_profile forwards every view and query here.
export const LEGACY_TASTE_PROFILE_PATH = `/${OWNER_HANDLE}/taste_profile`;

// The owner's personal site. The @handle on every public surface links here, so
// a visitor who likes the work has one obvious way out to the person behind it.
export const OWNER_SITE_URL = "https://mishabuloichyk.com";

// The way in. `/` is auth-split — signed out it bounces to the public surface,
// so it can't double as a sign-in. This path can: signed out it renders the
// login, signed in it is the curation console (or the vault, for a non-admin).
export const ADMIN_PATH = "/admin";
