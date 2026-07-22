create or replace function public.send_reminder_emails()
returns integer
language plpgsql
security definer
set search_path = public, extensions, vault, net
as $fn$
declare
  v_key text;
  v_sent int := 0;
  r record;
  v_rows text; v_html text; v_to jsonb;
  v_app text := 'https://chrislookup.github.io/nuway-hr/';
  v_episode date; v_nsent int; v_last timestamptz; v_send boolean;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'sendgrid_key' limit 1;
  if v_key is null then
    raise exception 'SendGrid key not found in Vault (expected secret name: sendgrid_key)';
  end if;

  -- 1) OVERDUE EMPLOYEE DIGESTS  (first overdue -> 14 days -> monthly)
  for r in
    select p.id, coalesce(p.first_name,'') as first_name, p.email
    from profiles p
    where p.status = 'active' and p.email is not null and p.email <> ''
      and exists (
        select 1 from assignments a
        where a.employee_id = p.id and a.due_date < current_date
          and not coalesce(a.suspended,false)
          and a.status not in ('completed','expired'))
  loop
    select min(a.due_date) into v_episode
      from assignments a
      where a.employee_id = r.id and a.due_date < current_date
        and not coalesce(a.suspended,false) and a.status not in ('completed','expired');

    select count(*), max(sent_at) into v_nsent, v_last
      from reminder_log
      where kind = 'overdue' and employee_id = r.id and sent_at::date >= v_episode;

    v_send := (v_nsent = 0)
           or (v_nsent = 1 and (current_date - v_episode) >= 14)
           or (v_nsent >= 2 and v_last is not null and (current_date - v_last::date) >= 30);
    if not v_send then continue; end if;

    select string_agg(
        '<tr><td style="padding:5px 12px;border-bottom:1px solid #eee">' || coalesce(d.code,'') || ' &mdash; ' || d.title ||
        '</td><td style="padding:5px 12px;border-bottom:1px solid #eee;color:#b00020;white-space:nowrap">' ||
        (current_date - a.due_date) || ' days overdue</td></tr>', '' order by a.due_date)
      into v_rows
      from assignments a join documents d on d.id = a.document_id
      where a.employee_id = r.id and a.due_date < current_date
        and not coalesce(a.suspended,false) and a.status not in ('completed','expired');

    v_html := '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;max-width:560px">'
      || '<p>Hi ' || r.first_name || ',</p>'
      || '<p>You have training &amp; compliance items that are now <b>overdue</b>. Please log in and complete them as soon as you can:</p>'
      || '<table style="border-collapse:collapse;margin:12px 0;width:100%">' || coalesce(v_rows,'') || '</table>'
      || '<p><a href="' || v_app || '" style="background:#0F6E6E;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Open Nuway HR</a></p>'
      || '<p style="color:#888;font-size:12px;margin-top:16px">If you have already completed these, no action is needed.</p></div>';

    perform net.http_post(
      url := 'https://api.sendgrid.com/v3/mail/send',
      headers := jsonb_build_object('Authorization','Bearer '||v_key,'Content-Type','application/json'),
      body := jsonb_build_object(
        'personalizations', jsonb_build_array(jsonb_build_object('to', jsonb_build_array(jsonb_build_object('email', r.email)))),
        'from', jsonb_build_object('email','employee@nuway.com.au','name','Nuway HR'),
        'subject', 'Overdue training & compliance items - Nuway HR',
        'content', jsonb_build_array(jsonb_build_object('type','text/html','value', v_html))
      )
    );
    insert into reminder_log(kind, employee_id) values ('overdue', r.id);
    v_sent := v_sent + 1;
  end loop;

  -- 2) FORTNIGHTLY STORE SUMMARIES  (to store email + optional second address; includes licence flag)
  for r in
    select l.id, l.name, l.email, l.email2
    from locations l
    where coalesce(l.active,true)
      and ((l.email is not null and l.email <> '') or (l.email2 is not null and l.email2 <> ''))
      and not exists (
        select 1 from reminder_log rl
        where rl.kind = 'store_summary' and rl.location_id = l.id
          and rl.sent_at::date > current_date - 14)
  loop
    select string_agg(
        '<tr><td style="padding:5px 12px;border-bottom:1px solid #eee">' || p.first_name || ' ' || coalesce(p.last_name,'') ||
        '</td><td style="padding:5px 12px;border-bottom:1px solid #eee">' ||
        (select count(*) from assignments a where a.employee_id=p.id and a.status not in ('completed','expired') and not coalesce(a.suspended,false)) ||
        '</td><td style="padding:5px 12px;border-bottom:1px solid #eee;color:#b00020">' ||
        (select count(*) from assignments a where a.employee_id=p.id and a.due_date<current_date and a.status not in ('completed','expired') and not coalesce(a.suspended,false)) ||
        '</td><td style="padding:5px 12px;border-bottom:1px solid #eee">' ||
        case when (select count(*) from licences lc where lc.employee_id=p.id and coalesce(lc.active,true) and lc.expiry_date is not null and lc.expiry_date <= current_date+30) > 0
             then '<span style="color:#b00020">' || (select count(*) from licences lc where lc.employee_id=p.id and coalesce(lc.active,true) and lc.expiry_date is not null and lc.expiry_date <= current_date+30) || ' expiring</span>'
             else '&mdash;' end ||
        '</td></tr>', '' order by p.first_name)
      into v_rows
      from profiles p
      join employee_locations el on el.employee_id = p.id
      where el.location_id = r.id and p.status = 'active';

    v_html := '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;max-width:680px">'
      || '<p>Fortnightly training &amp; compliance summary for <b>' || r.name || '</b>:</p>'
      || '<table style="border-collapse:collapse;margin:12px 0;width:100%">'
      || '<tr style="background:#0F6E6E;color:#fff"><th align="left" style="padding:6px 12px">Staff member</th><th align="left" style="padding:6px 12px">Outstanding</th><th align="left" style="padding:6px 12px">Overdue</th><th align="left" style="padding:6px 12px">Licences</th></tr>'
      || coalesce(v_rows,'<tr><td colspan="4" style="padding:6px 12px">No active staff.</td></tr>')
      || '</table>'
      || '<p style="color:#888;font-size:12px">&ldquo;Licences&rdquo; shows how many of that person&rsquo;s licences are within 30 days of expiry (or expired).</p>'
      || '<p><a href="' || v_app || '" style="background:#0F6E6E;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Open Nuway HR</a></p></div>';

    v_to := (select jsonb_agg(jsonb_build_object('email', e))
             from (select unnest(array[r.email, r.email2]) as e) x
             where e is not null and e <> '');

    perform net.http_post(
      url := 'https://api.sendgrid.com/v3/mail/send',
      headers := jsonb_build_object('Authorization','Bearer '||v_key,'Content-Type','application/json'),
      body := jsonb_build_object(
        'personalizations', jsonb_build_array(jsonb_build_object('to', v_to)),
        'from', jsonb_build_object('email','employee@nuway.com.au','name','Nuway HR'),
        'subject', 'Fortnightly training summary - ' || r.name,
        'content', jsonb_build_array(jsonb_build_object('type','text/html','value', v_html))
      )
    );
    insert into reminder_log(kind, location_id) values ('store_summary', r.id);
    v_sent := v_sent + 1;
  end loop;

  -- 3) LICENCE EXPIRY REMINDERS  (from 30 days before expiry, ~weekly, and once expired)
  for r in
    select p.id, coalesce(p.first_name,'') as first_name, p.email
    from profiles p
    where p.status = 'active' and p.email is not null and p.email <> ''
      and exists (select 1 from licences l where l.employee_id = p.id and coalesce(l.active,true)
                  and l.expiry_date is not null and l.expiry_date <= current_date + 30)
      and not exists (select 1 from reminder_log rl where rl.kind='licence' and rl.employee_id=p.id
                      and rl.sent_at::date > current_date - 7)
  loop
    select string_agg(
        '<tr><td style="padding:5px 12px;border-bottom:1px solid #eee">' || lt.name ||
        case when coalesce(l.licence_number,'')<>'' then ' (' || l.licence_number || ')' else '' end ||
        '</td><td style="padding:5px 12px;border-bottom:1px solid #eee;color:#b00020;white-space:nowrap">' ||
        case when l.expiry_date < current_date
             then 'EXPIRED ' || (current_date - l.expiry_date) || ' days ago'
             else 'expires in ' || (l.expiry_date - current_date) || ' days (' || to_char(l.expiry_date,'DD Mon YYYY') || ')' end ||
        '</td></tr>', '' order by l.expiry_date)
      into v_rows
      from licences l join licence_types lt on lt.id = l.licence_type_id
      where l.employee_id = r.id and coalesce(l.active,true)
        and l.expiry_date is not null and l.expiry_date <= current_date + 30;

    v_html := '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;max-width:560px">'
      || '<p>Hi ' || r.first_name || ',</p>'
      || '<p>One or more of your licences is <b>expiring soon</b> (or has expired). Please renew and upload the new details in Nuway HR:</p>'
      || '<table style="border-collapse:collapse;margin:12px 0;width:100%">' || coalesce(v_rows,'') || '</table>'
      || '<p><a href="' || v_app || '" style="background:#0F6E6E;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Open Nuway HR</a></p>'
      || '<p style="color:#888;font-size:12px;margin-top:16px">Already renewed? Update your licence in the app and these reminders will stop.</p></div>';

    perform net.http_post(
      url := 'https://api.sendgrid.com/v3/mail/send',
      headers := jsonb_build_object('Authorization','Bearer '||v_key,'Content-Type','application/json'),
      body := jsonb_build_object(
        'personalizations', jsonb_build_array(jsonb_build_object('to', jsonb_build_array(jsonb_build_object('email', r.email)))),
        'from', jsonb_build_object('email','employee@nuway.com.au','name','Nuway HR'),
        'subject', 'Licence expiring soon - Nuway HR',
        'content', jsonb_build_array(jsonb_build_object('type','text/html','value', v_html))
      )
    );
    insert into reminder_log(kind, employee_id) values ('licence', r.id);
    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$fn$;
