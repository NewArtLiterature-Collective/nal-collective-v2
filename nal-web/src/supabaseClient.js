import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://huyipckqstwwwtzeyygx.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1eWlwY2txc3R3d3d0emV5eWd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0NDA0NTUsImV4cCI6MjA5NDAxNjQ1NX0._iFffdjsxR7eqQSJfVs8fEoZOUxh2cgiWk1E4VPb82A'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)