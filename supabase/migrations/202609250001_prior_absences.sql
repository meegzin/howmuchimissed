alter table public.classes
  add column prior_absences integer not null default 0 check (prior_absences >= 0);

create or replace function public.save_class(
  p_id uuid, p_name text, p_total_minutes integer, p_meeting_minutes integer,
  p_prior_absences integer, p_schedules jsonb
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_id uuid; v_schedule jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_prior_absences is null or p_prior_absences < 0 then raise exception 'invalid prior absences'; end if;
  if p_id is null then
    insert into public.classes(user_id,name,total_minutes,meeting_minutes,prior_absences)
    values(auth.uid(),trim(p_name),p_total_minutes,p_meeting_minutes,p_prior_absences) returning id into v_id;
  else
    update public.classes set name=trim(p_name),total_minutes=p_total_minutes,
      meeting_minutes=p_meeting_minutes,prior_absences=p_prior_absences
    where id=p_id and user_id=auth.uid() returning id into v_id;
    if v_id is null then raise exception 'class not found'; end if;
    delete from public.class_schedules where class_id=v_id and user_id=auth.uid();
  end if;
  for v_schedule in select * from jsonb_array_elements(p_schedules) loop
    insert into public.class_schedules(class_id,user_id,weekday,start_time)
    values(v_id,auth.uid(),(v_schedule->>'weekday')::smallint,(v_schedule->>'startTime')::time);
  end loop;
  return v_id;
end $$;

create or replace function public.import_classes(p_subjects jsonb)
returns uuid[] language plpgsql security invoker set search_path = '' as $$
declare v_subject jsonb; v_ids uuid[] := '{}';
begin
  for v_subject in select * from jsonb_array_elements(p_subjects) loop
    v_ids := array_append(v_ids, public.save_class(null, v_subject->>'name',
      (v_subject->>'totalMinutes')::integer, (v_subject->>'meetingMinutes')::integer,
      coalesce((v_subject->>'priorAbsences')::integer,0), v_subject->'schedules'));
  end loop;
  return v_ids;
end $$;

revoke execute on function public.save_class(uuid,text,integer,integer,integer,jsonb) from public, anon;
revoke execute on function public.import_classes(jsonb) from public, anon;
grant execute on function public.save_class(uuid,text,integer,integer,integer,jsonb) to authenticated;
grant execute on function public.import_classes(jsonb) to authenticated;
