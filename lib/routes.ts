// Public taste-profile surface. Phase 1 is single-user, so the owner handle is
// pinned here; when multi-user lands this becomes `/${username}/taste_profile`.
export const OWNER_HANDLE = "misha.buloy";
export const TASTE_PROFILE_PATH = `/${OWNER_HANDLE}/taste_profile`;

// The owner's personal site. The @handle on every public surface links here, so
// a visitor who likes the work has one obvious way out to the person behind it.
export const OWNER_SITE_URL = "https://mishabuloichyk.com";
