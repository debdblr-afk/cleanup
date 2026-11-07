-- The private media bucket, for hosted projects (locally, config.toml also creates it).
-- No per-bucket size limit here: the project's global upload limit applies (50 MB on
-- Supabase's free plan, raise it under Storage settings on paid plans).
insert into storage.buckets (id, name, public, allowed_mime_types)
values ('media', 'media', false, array['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;
