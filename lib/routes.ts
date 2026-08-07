// Public taste-profile surface. Phase 1 is single-user, so the owner handle is
// pinned here; when multi-user lands this becomes `/${username}/taste_profile`.
export const OWNER_HANDLE = "misha.buloy";
export const TASTE_PROFILE_PATH = `/${OWNER_HANDLE}/taste_profile`;

// The owner's personal site. The @handle on every public surface links here, so
// a visitor who likes the work has one obvious way out to the person behind it.
export const OWNER_SITE_URL = "https://mishabuloichyk.com";

// The way in. `/` is auth-split — signed out it bounces to the public profile,
// so it can't double as a sign-in. This path can: signed out it renders the
// login, signed in it is the curation console (or the vault, for a non-admin).
export const ADMIN_PATH = "/admin";
