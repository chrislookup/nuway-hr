create or replace function public.send_form_email(
  p_to text, p_to_label text, p_subject text, p_html text, p_confirm_to text, p_form_title text)
returns void
language plpgsql security definer
set search_path = public, extensions, vault, net
as $fn$
declare v_key text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_to is null or p_to = '' then raise exception 'No recipient'; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'sendgrid_key' limit 1;
  if v_key is null then raise exception 'Email is not configured yet'; end if;

  perform net.http_post(
    'https://api.sendgrid.com/v3/mail/send',
    jsonb_build_object(
      'personalizations', jsonb_build_array(jsonb_build_object('to', jsonb_build_array(jsonb_build_object('email', p_to)))),
      'from', jsonb_build_object('email','employee@nuway.com.au','name','Nuway HR'),
      'subject', p_subject,
      'content', jsonb_build_array(jsonb_build_object('type','text/html','value', p_html))),
    '{}'::jsonb,
    jsonb_build_object('Authorization','Bearer '||v_key,'Content-Type','application/json'));

  if p_confirm_to is not null and p_confirm_to <> '' then
    perform net.http_post(
      'https://api.sendgrid.com/v3/mail/send',
      jsonb_build_object(
        'personalizations', jsonb_build_array(jsonb_build_object('to', jsonb_build_array(jsonb_build_object('email', p_confirm_to)))),
        'from', jsonb_build_object('email','employee@nuway.com.au','name','Nuway HR'),
        'subject', 'Submitted: ' || p_form_title,
        'content', jsonb_build_array(jsonb_build_object('type','text/html','value',
          '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222"><p>Your <b>' || p_form_title ||
          '</b> has been submitted to ' || coalesce(p_to_label, p_to) || ' (' || p_to || ').</p><p>Here is a copy of what you sent:</p>' ||
          p_html || '</div>'))),
      '{}'::jsonb,
      jsonb_build_object('Authorization','Bearer '||v_key,'Content-Type','application/json'));
  end if;
end;
$fn$;
grant execute on function public.send_form_email(text,text,text,text,text,text) to authenticated;
