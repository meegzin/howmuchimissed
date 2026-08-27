create extension if not exists pgcrypto;

create table public.semesters (
  user_id uuid primary key references auth.users(id) on delete cascade,
  start_date date not null
);
create table public.classes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  total_minutes integer not null check (total_minutes > 0),
  meeting_minutes integer not null check (meeting_minutes > 0 and meeting_minutes <= total_minutes),
  created_at timestamptz not null default now(),
  unique (id, user_id)
);
create table public.class_schedules (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  foreign key (class_id, user_id) references public.classes(id, user_id) on delete cascade,
  unique (class_id, weekday, start_time),
  unique (class_id, weekday)
);
create table public.absences (
  class_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  foreign key (class_id, user_id) references public.classes(id, user_id) on delete cascade,
  primary key (class_id, date)
);
create table public.exclusions (
  class_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  reinstated boolean not null default false,
  foreign key (class_id, user_id) references public.classes(id, user_id) on delete cascade,
  primary key (class_id, date)
);

create index classes_user_id_idx on public.classes(user_id);
create index class_schedules_user_id_idx on public.class_schedules(user_id);
create index absences_user_id_idx on public.absences(user_id);
create index exclusions_user_id_idx on public.exclusions(user_id);

alter table public.semesters enable row level security;
alter table public.classes enable row level security;
alter table public.class_schedules enable row level security;
alter table public.absences enable row level security;
alter table public.exclusions enable row level security;

create policy semesters_owner on public.semesters for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy classes_owner on public.classes for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy schedules_owner on public.class_schedules for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy absences_owner on public.absences for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy exclusions_owner on public.exclusions for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create or replace function public.save_class(
  p_id uuid, p_name text, p_total_minutes integer, p_meeting_minutes integer, p_schedules jsonb
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_id uuid; v_schedule jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_id is null then
    insert into public.classes(user_id,name,total_minutes,meeting_minutes)
    values(auth.uid(),trim(p_name),p_total_minutes,p_meeting_minutes) returning id into v_id;
  else
    update public.classes set name=trim(p_name),total_minutes=p_total_minutes,meeting_minutes=p_meeting_minutes
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
    v_ids := array_append(v_ids, public.save_class(null, v_subject->>'name', (v_subject->>'totalMinutes')::integer, (v_subject->>'meetingMinutes')::integer, v_subject->'schedules'));
  end loop;
  return v_ids;
end $$;

revoke execute on function public.save_class(uuid,text,integer,integer,jsonb) from public, anon;
revoke execute on function public.import_classes(jsonb) from public, anon;
grant execute on function public.save_class(uuid,text,integer,integer,jsonb) to authenticated;
grant execute on function public.import_classes(jsonb) to authenticated;
