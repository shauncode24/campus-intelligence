import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://qqdonjhgvuyjfusplexf.supabase.co";
const supabaseAnonKey = "sb_publishable_9eYYSwR8aZkL-u4vaOSy2g_AoXwA-tU";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
