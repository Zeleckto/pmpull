// Picks the backend. Nothing else in the app knows or cares which one is in use.
//
//   VITE_SUPABASE_URL set  ->  Supabase cloud (the original Netlify deployment)
//   not set                ->  the offline server on this machine, over /api
//
// Because the offline path uses a RELATIVE url, the server's IP is never baked
// into the build. Move the server, change its address, nothing needs rebuilding.
import { createClient } from "@supabase/supabase-js";
import { createLocalClient } from "./localClient";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const backendMode = url && key ? "cloud" : "local";
export const supabase = backendMode === "cloud" ? createClient(url, key) : createLocalClient("/api");

// Kept for the screens that show a connection banner. There is always a backend
// now, so this is true either way; the banner reads `backendMode` for the detail.
export const hasSupabase = true;
