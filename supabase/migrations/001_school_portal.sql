-- Madda Walabu Academy: initial Supabase schema
-- Run only after reviewing the RLS policies below. All portal data is private by default.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  role text not null default 'student' check (role in ('admin','registrar','teacher','student')),
  status text not null default 'Pending' check (status in ('Pending','Active','Inactive')),
  student_number text unique,
  grade text,
  room text,
  subject text,
  guardian text,
  phone text,
  date_of_birth date,
  home_address text,
  emergency_contact text,
  transcript_status text not null default 'Not requested' check (transcript_status in ('Not requested','Pending','Approved')),
  transcript_approved_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.school_settings (
  singleton boolean primary key default true check (singleton),
  school_name text not null default 'Madda Walabu Academy',
  academic_year text not null default '2026–2027',
  current_semester text not null default 'Semester 1',
  registration_open boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.school_settings(singleton) values (true) on conflict (singleton) do nothing;

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  grade text not null,
  subject text not null,
  teacher_id uuid references public.profiles(id) on delete set null,
  room text not null default '',
  created_at timestamptz not null default now()
);
create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  attendance_date date not null default current_date,
  present_count integer not null check (present_count >= 0),
  absent_count integer not null check (absent_count >= 0),
  notes text not null default '',
  submitted_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(class_id, attendance_date)
);
create table if not exists public.grades (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  class_id uuid references public.classes(id) on delete set null,
  subject text not null,
  semester text not null default 'Semester 1',
  score numeric(5,2) not null check (score between 0 and 100),
  letter_grade text not null default '',
  assessment text not null default 'Assessment',
  entered_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subject text not null,
  grade text not null,
  teacher_id uuid not null references public.profiles(id),
  duration_minutes integer not null check (duration_minutes between 1 and 300),
  opens_at timestamptz not null,
  closes_at timestamptz,
  status text not null default 'Open' check (status in ('Draft','Open','Closed')),
  created_at timestamptz not null default now()
);
create table if not exists public.exam_questions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  position integer not null,
  prompt text not null,
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) >= 2),
  unique(exam_id, position)
);
-- Correct answers live in a separate table so students cannot fetch an answer key.
create table if not exists public.exam_answer_keys (
  question_id uuid primary key references public.exam_questions(id) on delete cascade,
  correct_option integer not null check (correct_option >= 0)
);
create table if not exists public.exam_submissions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  score numeric(5,2) not null check (score between 0 and 100),
  submitted_at timestamptz not null default now(),
  unique(exam_id, student_id)
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  description text not null,
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'Pending' check (status in ('Pending','Paid','Waived','Rejected')),
  payment_method text not null default 'Awaiting payment',
  reference text not null default '',
  recorded_by uuid references public.profiles(id),
  payment_date date not null default current_date,
  created_at timestamptz not null default now()
);
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  audience text not null default 'Everyone' check (audience in ('Everyone','Families','Students','Staff')),
  author_id uuid not null references public.profiles(id),
  published_at timestamptz not null default now()
);
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid references public.profiles(id) on delete cascade,
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists profiles_grade_idx on public.profiles(grade);
create index if not exists grades_student_idx on public.grades(student_id, semester);
create index if not exists exams_grade_open_idx on public.exams(grade, status, opens_at);
create index if not exists messages_conversation_idx on public.messages(sender_id, recipient_id, created_at);

-- Every new Auth account is a pending student. Staff accounts must be provisioned by an admin.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id,email,full_name,role,status,grade,guardian,phone,student_number)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name','New student'), 'student', 'Pending',
    new.raw_user_meta_data->>'grade', new.raw_user_meta_data->>'guardian', new.raw_user_meta_data->>'phone',
    'MWA-' || upper(substr(replace(new.id::text,'-',''),1,8)))
  on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created_school_profile on auth.users;
create trigger on_auth_user_created_school_profile after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Helper runs with the table owner's privileges to avoid recursive profile RLS checks.
create or replace function public.school_role()
returns text language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = (select auth.uid()) and status = 'Active'
$$;
create or replace function public.is_school_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.school_role() in ('admin','registrar','teacher'), false)
$$;
create or replace function public.can_teach_class(target_class uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.classes c where c.id=target_class and c.teacher_id=(select auth.uid()))
$$;

-- A student may update contact details only; enrollment status, role, grade and transcript
-- approval remain controlled by school staff even when the profile belongs to that student.
create or replace function public.protect_student_profile_fields()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.role is distinct from old.role and public.school_role() <> 'admin' then
    raise exception 'Only an administrator may change account roles';
  end if;
  if old.id=(select auth.uid()) and old.role='student' then
    if new.role is distinct from old.role or new.status is distinct from old.status or
       new.grade is distinct from old.grade or new.room is distinct from old.room or
       new.student_number is distinct from old.student_number or
       new.transcript_status is distinct from old.transcript_status or
       new.transcript_approved_by is distinct from old.transcript_approved_by then
      raise exception 'Students may not change protected enrollment or academic fields';
    end if;
  end if;
  new.updated_at := now();
  return new;
end; $$;
drop trigger if exists protect_student_profile_fields_trigger on public.profiles;
create trigger protect_student_profile_fields_trigger before update on public.profiles
for each row execute procedure public.protect_student_profile_fields();

alter table public.profiles enable row level security;
alter table public.school_settings enable row level security;
alter table public.classes enable row level security;
alter table public.attendance enable row level security;
alter table public.grades enable row level security;
alter table public.exams enable row level security;
alter table public.exam_questions enable row level security;
alter table public.exam_answer_keys enable row level security;
alter table public.exam_submissions enable row level security;
alter table public.payments enable row level security;
alter table public.announcements enable row level security;
alter table public.messages enable row level security;

create policy "profiles_read_self_or_school_staff" on public.profiles for select to authenticated
using (id=(select auth.uid()) or public.school_role() in ('admin','registrar') or
  (public.school_role()='teacher' and exists(select 1 from public.classes c where c.grade=profiles.grade and c.teacher_id=(select auth.uid()))));
create policy "profiles_admin_manage" on public.profiles for all to authenticated
using (public.school_role() in ('admin','registrar')) with check (public.school_role() in ('admin','registrar'));
create policy "profiles_student_update_contact" on public.profiles for update to authenticated
using (id=(select auth.uid()) and role='student') with check (id=(select auth.uid()) and role='student' and status in ('Pending','Active','Inactive'));

create policy "settings_read" on public.school_settings for select to anon, authenticated using (true);
create policy "settings_admin_manage" on public.school_settings for all to authenticated
using (public.school_role()='admin') with check (public.school_role()='admin');

create policy "classes_read_authenticated" on public.classes for select to authenticated using (true);
create policy "classes_admin_manage" on public.classes for all to authenticated
using (public.school_role()='admin') with check (public.school_role()='admin');

create policy "attendance_read_authorized" on public.attendance for select to authenticated
using (public.school_role() in ('admin','registrar') or submitted_by=(select auth.uid()) or public.can_teach_class(class_id));
create policy "attendance_teacher_submit" on public.attendance for insert to authenticated
with check (public.school_role() in ('admin','teacher') and (public.school_role()='admin' or (submitted_by=(select auth.uid()) and public.can_teach_class(class_id))));
create policy "attendance_staff_update" on public.attendance for update to authenticated
using (public.school_role() in ('admin','registrar') or public.can_teach_class(class_id))
with check (public.school_role() in ('admin','registrar') or public.can_teach_class(class_id));

create policy "grades_read_authorized" on public.grades for select to authenticated
using (student_id=(select auth.uid()) or public.school_role() in ('admin','registrar') or (public.school_role()='teacher' and (entered_by=(select auth.uid()) or (class_id is not null and public.can_teach_class(class_id)))));
create policy "grades_staff_insert" on public.grades for insert to authenticated
with check ((public.school_role()='admin') or (public.school_role()='teacher' and entered_by=(select auth.uid()) and (class_id is null or public.can_teach_class(class_id))));
create policy "grades_staff_update" on public.grades for update to authenticated
using (public.school_role()='admin' or (public.school_role()='teacher' and entered_by=(select auth.uid())))
with check (public.school_role()='admin' or (public.school_role()='teacher' and entered_by=(select auth.uid())));

create policy "exams_read_class" on public.exams for select to authenticated
using (public.school_role() in ('admin','registrar') or teacher_id=(select auth.uid()) or
  (public.school_role()='student' and status='Open' and opens_at<=now() and (closes_at is null or closes_at>now()) and grade=(select p.grade from public.profiles p where p.id=(select auth.uid()))));
create policy "exams_teacher_manage" on public.exams for all to authenticated
using (public.school_role()='admin' or (public.school_role()='teacher' and teacher_id=(select auth.uid())))
with check (public.school_role()='admin' or (public.school_role()='teacher' and teacher_id=(select auth.uid())));
create policy "questions_read_without_answers" on public.exam_questions for select to authenticated
using (exists(select 1 from public.exams e where e.id=exam_id and (public.school_role() in ('admin','registrar') or e.teacher_id=(select auth.uid()) or (public.school_role()='student' and e.status='Open' and e.opens_at<=now() and (e.closes_at is null or e.closes_at>now()) and e.grade=(select p.grade from public.profiles p where p.id=(select auth.uid()))))));
create policy "questions_teacher_manage" on public.exam_questions for all to authenticated
using (public.school_role()='admin' or exists(select 1 from public.exams e where e.id=exam_id and e.teacher_id=(select auth.uid())))
with check (public.school_role()='admin' or exists(select 1 from public.exams e where e.id=exam_id and e.teacher_id=(select auth.uid())));
create policy "answer_keys_staff_only" on public.exam_answer_keys for select to authenticated
using (public.school_role() in ('admin','registrar') or exists(select 1 from public.exam_questions q join public.exams e on e.id=q.exam_id where q.id=question_id and e.teacher_id=(select auth.uid())));
create policy "answer_keys_teacher_manage" on public.exam_answer_keys for all to authenticated
using (public.school_role()='admin' or exists(select 1 from public.exam_questions q join public.exams e on e.id=q.exam_id where q.id=question_id and e.teacher_id=(select auth.uid())))
with check (public.school_role()='admin' or exists(select 1 from public.exam_questions q join public.exams e on e.id=q.exam_id where q.id=question_id and e.teacher_id=(select auth.uid())));
create policy "submissions_read_authorized" on public.exam_submissions for select to authenticated
using (student_id=(select auth.uid()) or public.school_role() in ('admin','registrar') or exists(select 1 from public.exams e where e.id=exam_id and e.teacher_id=(select auth.uid())));

create policy "payments_read_own_or_finance" on public.payments for select to authenticated
using (student_id=(select auth.uid()) or public.school_role() in ('admin','registrar'));
create policy "payments_student_request" on public.payments for insert to authenticated
with check (student_id=(select auth.uid()) and status='Pending' and recorded_by is null);
create policy "payments_finance_manage" on public.payments for all to authenticated
using (public.school_role() in ('admin','registrar')) with check (public.school_role() in ('admin','registrar'));

create policy "announcements_read_audience" on public.announcements for select to authenticated
using (audience='Everyone' or (audience='Students' and public.school_role()='student') or (audience='Staff' and public.is_school_staff()) or (audience='Families' and public.school_role() in ('student','registrar','admin')));
create policy "announcements_staff_publish" on public.announcements for all to authenticated
using (public.school_role() in ('admin','registrar','teacher')) with check (public.school_role() in ('admin','registrar','teacher'));

create policy "messages_read_participants_or_office" on public.messages for select to authenticated
using (sender_id=(select auth.uid()) or recipient_id=(select auth.uid()) or public.school_role() in ('admin','registrar'));
create policy "messages_send_as_self" on public.messages for insert to authenticated
with check (sender_id=(select auth.uid()));

-- Students submit only answer selections. The database scores the attempt without exposing the key.
create or replace function public.submit_exam(p_exam_id uuid, p_answers jsonb)
returns table(score numeric, correct_count integer, question_count integer, submitted_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_student uuid := (select auth.uid()); v_grade text; v_exam public.exams%rowtype;
  v_total integer; v_correct integer; v_score numeric(5,2); v_submitted timestamptz := now();
begin
  if v_student is null then raise exception 'Sign in is required'; end if;
  select grade,status into v_grade from public.profiles where id=v_student and role='student' and status='Active';
  if v_grade is null then raise exception 'Active student account required'; end if;
  select * into v_exam from public.exams where id=p_exam_id for update;
  if not found or v_exam.status<>'Open' or v_exam.opens_at>now() or (v_exam.closes_at is not null and v_exam.closes_at<=now()) or v_exam.grade<>v_grade then raise exception 'Assessment is not available'; end if;
  if exists(select 1 from public.exam_submissions where exam_id=p_exam_id and student_id=v_student) then raise exception 'Assessment was already submitted'; end if;
  if v_submitted > v_exam.opens_at + make_interval(mins => v_exam.duration_minutes) then raise exception 'Assessment time has ended'; end if;
  select count(*), count(*) filter (where (p_answers->>q.id::text)::integer=k.correct_option)
    into v_total,v_correct from public.exam_questions q join public.exam_answer_keys k on k.question_id=q.id where q.exam_id=p_exam_id;
  if v_total=0 then raise exception 'Assessment has no answer key'; end if;
  v_score := round(v_correct::numeric*100/v_total,2);
  insert into public.exam_submissions(exam_id,student_id,answers,score,submitted_at) values(p_exam_id,v_student,p_answers,v_score,v_submitted);
  insert into public.grades(student_id,subject,semester,score,letter_grade,assessment,entered_by)
    values(v_student,v_exam.subject,'Semester 1',v_score,case when v_score>=90 then 'A' when v_score>=85 then 'B+' when v_score>=80 then 'B' when v_score>=70 then 'C' when v_score>=60 then 'D' else 'F' end,v_exam.title,v_student);
  return query select v_score,v_correct,v_total,v_submitted;
end; $$;
revoke all on function public.submit_exam(uuid,jsonb) from public, anon;
grant execute on function public.submit_exam(uuid,jsonb) to authenticated;

grant usage on schema public to anon, authenticated;
grant select on public.school_settings to anon, authenticated;
grant update on public.school_settings to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.classes, public.attendance, public.grades, public.exams, public.exam_questions, public.exam_answer_keys, public.payments, public.announcements, public.messages to authenticated;
grant select on public.exam_submissions to authenticated;

