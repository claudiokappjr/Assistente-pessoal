-- Arquivos da Saúde (PDFs e fotos de exames/receitas) em bucket privado.
-- Caminho: <id do dono>/<tipo>/<arquivo>. Acesso só por URL temporária.
-- (Bloco ignorado em bancos sem o schema storage, como o de testes local.)
do $$
begin
  if to_regclass('storage.objects') is null then return; end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('health-files', 'health-files', false, 15728640,
          array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'])
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

  execute $p$create policy "saude: dono envia arquivo" on storage.objects for insert to authenticated
    with check (bucket_id = 'health-files' and (storage.foldername(name))[1] = (select auth.uid())::text)$p$;
  execute $p$create policy "saude: dono e profissional autorizado leem arquivo" on storage.objects for select to authenticated
    using (bucket_id = 'health-files' and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or private.has_consent(((storage.foldername(name))[1])::uuid, 'saude')))$p$;
  execute $p$create policy "saude: dono apaga arquivo" on storage.objects for delete to authenticated
    using (bucket_id = 'health-files' and (storage.foldername(name))[1] = (select auth.uid())::text)$p$;
end $$;
