import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://biluxvnrawqfsyixhffr.supabase.co'
const supabaseKey = 'sb_publishable_l-MGApBA-HdcrkdnMUGTDQ_4RGJ34rB'

export const supabase = createClient(supabaseUrl, supabaseKey)
