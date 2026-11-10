/* Authenticated Supabase adapter for the existing SchoolOS screens.
   It only uses the browser publishable key; RLS is enforced by Postgres. */
(() => {
  const table = (sb, name) => sb.from(name);
  let sb = null, baseline = null, loading = false, syncTimer = 0, syncRunning = false;
  const say = text => window.toast?.(text);
  const state = () => window.schoolGetData();
  const person = (p, teacherNames = {}) => ({
    authId: p.id, name: p.full_name, email: p.email, role: p.role, status: p.status,
    id: p.student_number || p.id, grade: p.grade || '—', room: p.room || '—', subject: p.subject || '',
    guardian: p.guardian || '—', phone: p.phone || '—', dob: p.date_of_birth || '', address: p.home_address || '',
    emergency: p.emergency_contact || '', transcript: p.transcript_status || 'Not requested',
    transcriptApprovedBy: teacherNames[p.transcript_approved_by] || '', transcriptApprovedAt:p.updated_at
  });
  const first = (map, id) => { const value=map?.get?.(id); return value?.name || value || '—'; };
  async function result(q) { const { data, error } = await q; if (error) throw error; return data ?? []; }

  async function hydrate() {
    const [profiles, classes, grades, attendance, exams, questions, answerKeys, submissions, payments, notices, messages, settings] = await Promise.all([
      result(table(sb,'profiles').select('*')),
      result(table(sb,'classes').select('*')),
      result(table(sb,'grades').select('*')),
      result(table(sb,'attendance').select('*')),
      result(table(sb,'exams').select('*')),
      result(table(sb,'exam_questions').select('*')),
      result(table(sb,'exam_answer_keys').select('*')),
      result(table(sb,'exam_submissions').select('*')),
      result(table(sb,'payments').select('*')),
      result(table(sb,'announcements').select('*')),
      result(table(sb,'messages').select('*')),
      result(table(sb,'school_settings').select('*').eq('singleton',true).maybeSingle())
    ]);
    const profileById = new Map(profiles.map(p=>[p.id,p]));
    const profileByName = new Map(profiles.map(p=>[p.full_name,p]));
    const keyByQuestion = new Map(answerKeys.map(k=>[k.question_id,k.correct_option]));
    const qByExam = new Map();
    questions.forEach(q=>{const a=qByExam.get(q.exam_id)||[];a.push({...q,text:q.prompt,answer:keyByQuestion.get(q.id)});qByExam.set(q.exam_id,a)});
    const submissionsByExam = new Map();
    submissions.forEach(x=>{const a=submissionsByExam.get(x.exam_id)||{};a[x.student_id]={score:Number(x.score),correct:x.score,total:100,date:x.submitted_at.slice(0,10)};submissionsByExam.set(x.exam_id,a)});
    const profileMap = new Map(profiles.map(p=>[p.id,person(p,Object.fromEntries(profiles.map(x=>[x.id,x.full_name])))]));
    const authUser = (await sb.auth.getUser()).data.user;
    const self = profileById.get(authUser?.id);
    if (!self) throw new Error('Your authenticated Supabase user does not have a school profile yet.');
    if (self.status !== 'Active') throw new Error('Your school account is awaiting approval. Ask the registrar or first administrator to activate it.');
    const current = person(self,Object.fromEntries(profiles.map(x=>[x.id,x.full_name])));
    const next = {
      settings:{registrationOpen:settings?.registration_open ?? true,school:settings?.school_name||'Madda Walabu Academy',academicYear:settings?.academic_year||'2026–2027',semester:settings?.current_semester||'Semester 1'},
      users:profiles.map(p=>person(p,Object.fromEntries(profiles.map(x=>[x.id,x.full_name])))),
      subjects:state().subjects || [],
      classes:classes.map(c=>({authId:c.id,name:c.name,grade:c.grade,subject:c.subject,teacher:first(profileMap,c.teacher_id),teacherId:c.teacher_id,room:c.room,students:profiles.filter(p=>p.role==='student'&&p.grade===c.grade&&p.status==='Active').length})),
      attendance:attendance.map(a=>({authId:a.id,className:first(new Map(classes.map(x=>[x.id,x.name])),a.class_id),present:a.present_count,absent:a.absent_count,date:a.attendance_date,teacher:first(profileMap,a.submitted_by),classId:a.class_id})),
      grades:grades.map(g=>({authId:g.id,student:first(profileMap,g.student_id),studentAuthId:g.student_id,grade:profileById.get(g.student_id)?.grade||'—',subject:g.subject,term:g.semester,score:Number(g.score),letter:g.letter_grade||'',assessment:g.assessment,enteredBy:g.entered_by})),
      exams:exams.map(x=>({id:x.id,authId:x.id,title:x.title,subject:x.subject,grade:x.grade,teacher:first(profileMap,x.teacher_id),teacherId:x.teacher_id,minutes:x.duration_minutes,opens:x.opens_at,closes:x.closes_at,status:x.status,questions:qByExam.get(x.id)||[],results:submissionsByExam.get(x.id)||{}})),
      payments:payments.map(p=>({authId:p.id,id:p.id,student:first(profileMap,p.student_id),studentAuthId:p.student_id,description:p.description,amount:Number(p.amount),status:p.status,date:p.payment_date,method:p.payment_method,reference:p.reference})),
      notices:notices.map(n=>({authId:n.id,title:n.title,body:n.body,tag:n.audience,audience:n.audience,date:n.published_at.slice(0,10),author:first(profileMap,n.author_id)})),
      chat:messages.map(m=>({authId:m.id,sender:profileById.get(m.sender_id)?.email||'office',name:first(profileMap,m.sender_id),text:m.body,time:m.created_at,recipientId:m.recipient_id})),
      attendanceCache:[]
    };
    window.schoolSetCurrent(current);
    window.schoolReplaceData(next);
    baseline = structuredClone(next);
    return current;
  }

  function snapshotKey(row, idKey='authId') {
    if (row[idKey]) return row[idKey];
    if (row.className) return `${row.className}|${row.date||''}`;
    if (row.student && row.description) return `${row.student}|${row.description}|${row.date||''}|${row.amount||''}`;
    if (row.sender && row.text) return `${row.sender}|${row.text}|${row.time||''}`;
    if (row.student && row.subject) return `${row.student}|${row.grade||''}|${row.subject}|${row.term||''}|${row.assessment||''}`;
    return `${row.id||row.name||row.title||row.student||''}|${row.date||row.grade||''}|${row.subject||row.body||''}`;
  }
  function changed(a,b,keys) { return keys.some(k=>JSON.stringify(a?.[k]??null)!==JSON.stringify(b?.[k]??null)); }
  const mapBy=(arr,key)=>new Map((arr||[]).map(x=>[snapshotKey(x,key),x]));
  async function syncChanges() {
    if (!sb || !baseline || syncRunning || loading) return;
    syncRunning = true;
    try {
      const d=state(), before=baseline, me=window.schoolGetCurrent();
      // Profile and transcript changes
      const oldUsers=mapBy(before.users), seenUsers=new Map();
      for (const u of d.users||[]) {
        const old=oldUsers.get(snapshotKey(u)); seenUsers.set(snapshotKey(u),true);
        if (old && u.authId && changed(u,old,['name','status','grade','room','guardian','phone','dob','address','emergency','transcript'])) {
          const payload={full_name:u.name,status:u.status,grade:u.grade==='—'?null:u.grade,room:u.room==='—'?null:u.room,guardian:u.guardian==='—'?null:u.guardian,phone:u.phone==='—'?null:u.phone,date_of_birth:u.dob||null,home_address:u.address||null,emergency_contact:u.emergency||null,transcript_status:u.transcript||'Not requested'};
          if(u.transcriptApprovedBy) payload.transcript_approved_by=(d.users||[]).find(x=>x.name===u.transcriptApprovedBy)?.authId||null;
          await result(table(sb,'profiles').update(payload).eq('id',u.authId).select('id'));
        }
      }
      // Classes
      const oldClasses=mapBy(before.classes), classIds=new Map((d.classes||[]).map(x=>[x.name,x.authId]));
      for(const c of d.classes||[]){const old=oldClasses.get(snapshotKey(c));if(!old||changed(c,old,['name','grade','subject','teacher','room'])){
        const teacher=(d.users||[]).find(u=>u.name===c.teacher&&u.role==='teacher');
        const payload={name:c.name,grade:c.grade,subject:c.subject,teacher_id:teacher?.authId||c.teacherId||null,room:c.room||''};
        if(c.authId) await result(table(sb,'classes').update(payload).eq('id',c.authId).select('id'));
        else {const row=await result(table(sb,'classes').insert(payload).select('id').single());c.authId=row.id;classIds.set(c.name,row.id)}
      }}
      // Attendance: one daily row per class.
      const oldAttendance=new Map((before.attendance||[]).map(a=>[`${a.className}|${a.date}`,a]));
      for(const a of d.attendance||[]){const key=`${a.className}|${a.date}`;const old=oldAttendance.get(key);if(!old||changed(a,old,['present','absent'])){
        const classId=a.classId||classIds.get(a.className)||(d.classes||[]).find(x=>x.name===a.className)?.authId;
        if(classId) await result(table(sb,'attendance').upsert({class_id:classId,attendance_date:a.date,present_count:+a.present,absent_count:+a.absent,submitted_by:me.authId},{onConflict:'class_id,attendance_date'}).select('id'));
      }}
      // Grades
      const oldGrades=mapBy(before.grades), gradeKeys=new Set();
      for(const g of d.grades||[]){const key=snapshotKey(g);gradeKeys.add(key);if(!oldGrades.has(key)){
        const student=(d.users||[]).find(u=>u.name===g.student);if(!student?.authId)continue;
        const cl=(d.classes||[]).find(x=>x.grade===g.grade&&x.subject===g.subject);
        const row=await result(table(sb,'grades').insert({student_id:student.authId,class_id:cl?.authId||null,subject:g.subject,semester:g.term||'Semester 1',score:+g.score,letter_grade:g.letter||'',assessment:g.assessment||'Assessment',entered_by:me.authId}).select('id').single());g.authId=row.id;
      }}
      // Exams and answer keys are written once; students never receive answer keys.
      const oldExams=mapBy(before.exams,'id');
      for(const ex of d.exams||[]){if(!oldExams.has(snapshotKey(ex,'id'))){
        const teacher=(d.users||[]).find(u=>u.name===ex.teacher&&u.role==='teacher');
        const row=await result(table(sb,'exams').insert({title:ex.title,subject:ex.subject,grade:ex.grade,teacher_id:teacher?.authId||me.authId,duration_minutes:+ex.minutes,opens_at:new Date(ex.opens).toISOString(),closes_at:ex.closes||null,status:ex.status||'Open'}).select('id').single());
        ex.id=row.id;ex.authId=row.id;
        for(let i=0;i<(ex.questions||[]).length;i++){const q=ex.questions[i],newQ=await result(table(sb,'exam_questions').insert({exam_id:row.id,position:i+1,prompt:q.text,options:q.options}).select('id').single());q.id=newQ.id;if(Number.isInteger(q.answer)) await result(table(sb,'exam_answer_keys').insert({question_id:newQ.id,correct_option:q.answer}));}
      }}
      // Payment ledger (request records only; no card charge is performed).
      const oldPayments=mapBy(before.payments), paymentKeys=new Set();
      for(const p of d.payments||[]){const key=snapshotKey(p);paymentKeys.add(key);const old=oldPayments.get(key);const student=(d.users||[]).find(u=>u.name===p.student);if(!student?.authId)continue;
        if(!old){const row=await result(table(sb,'payments').insert({student_id:student.authId,description:p.description,amount:+p.amount,status:p.status||'Pending',payment_method:p.method||'Awaiting payment',reference:p.reference||'',recorded_by:me.role==='student'?null:me.authId,payment_date:p.date}).select('id').single());p.authId=row.id;p.id=row.id;}
        else if(changed(p,old,['status','method','reference'])) await result(table(sb,'payments').update({status:p.status,payment_method:p.method,reference:p.reference||'',recorded_by:me.role==='student'?null:me.authId}).eq('id',p.authId).select('id'));
      }
      // Announcements
      const oldNotices=mapBy(before.notices), noticeIds=new Set();
      for(const n of d.notices||[]){const key=snapshotKey(n);noticeIds.add(key);if(!oldNotices.has(key)){const row=await result(table(sb,'announcements').insert({title:n.title,body:n.body,audience:n.audience||n.tag||'Everyone',author_id:me.authId,published_at:new Date(n.date).toISOString()}).select('id').single());n.authId=row.id}}
      // Private office messages
      const oldChat=mapBy(before.chat);for(const m of d.chat||[]){if(!oldChat.has(snapshotKey(m))){const row=await result(table(sb,'messages').insert({sender_id:me.authId,recipient_id:m.recipientId||null,body:m.text}).select('id').single());m.authId=row.id}}
      if(JSON.stringify(d.settings)!==JSON.stringify(before.settings)) await result(table(sb,'school_settings').update({school_name:d.settings.school,registration_open:!!d.settings.registrationOpen,academic_year:d.settings.academicYear||'2026–2027',current_semester:d.settings.semester||'Semester 1'}).eq('singleton',true).select('singleton'));
      baseline=structuredClone(d);
    } catch(e) {
      console.error('Supabase save failed',e);
      say(`Could not save to Supabase: ${e.message||'check your account permissions'}`);
    } finally { syncRunning=false; }
  }
  function scheduleSync(){clearTimeout(syncTimer);syncTimer=setTimeout(()=>void syncChanges(),220)}

  async function signIn(e){e.preventDefault();const email=document.getElementById('loginEmail').value.trim(),password=document.getElementById('loginPassword').value;try{
    const {error}=await sb.auth.signInWithPassword({email,password});if(error)throw error;
    loading=true;await hydrate();loading=false;window.enterPortal();
  }catch(err){loading=false;await sb.auth.signOut();say(err.message||'Sign-in failed.');}}
  async function dPushChat(body){const me=window.schoolGetCurrent();try{await result(table(sb,'messages').insert({sender_id:me.authId,recipient_id:null,body}).select('id').single());document.getElementById('chatInput').value='';await reloadData();renderChat();document.getElementById('chatDrawer').classList.add('open')}catch(e){say(e.message)}}
  async function signUp(e){e.preventDefault();const f=new FormData(e.currentTarget),email=String(f.get('email')).trim().toLowerCase();try{
    const {data:schoolSettings,error:settingsError}=await table(sb,'school_settings').select('registration_open').eq('singleton',true).maybeSingle();if(settingsError)throw settingsError;if(schoolSettings?.registration_open===false)throw new Error('Student registration is currently closed.');
    const {data,error}=await sb.auth.signUp({email,password:String(f.get('password')),options:{data:{full_name:String(f.get('name')).trim(),grade:f.get('grade'),guardian:f.get('guardian'),phone:f.get('phone')||''}}});if(error)throw error;
    e.currentTarget.reset();authTab('login');say(data.session?'Request sent. A registrar must approve the account before portal access.':'Check your email to confirm the account, then a registrar must approve it before portal access.');
  }catch(err){say(err.message||'Could not submit the enrollment request.')}}
  async function reloadData(){loading=true;try{await hydrate();}finally{loading=false}}

  window.progressChart=grades=>{
    const d=state(), subjects=(d.subjects||[]).map(name=>({name,rows:(grades||[]).filter(g=>g.subject===name)})).filter(x=>x.rows.length);
    if(!subjects.length)return '<div class="empty">Published assessment results will appear here.</div>';
    const points=subjects.map((x,i)=>({x:45+(subjects.length===1?0:i*570/(subjects.length-1)),y:145-Math.min(100,Math.max(0,x.rows.reduce((a,g)=>a+Number(g.score),0)/x.rows.length))*1.15,name:x.name}));
    const line=points.map(p=>`${p.x} ${p.y}`).join(' L');
    return `<div class="chart"><svg viewBox="0 0 640 170" preserveAspectRatio="none"><defs><linearGradient id="fade" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#6f9c79" stop-opacity=".2"/><stop offset="1" stop-color="#6f9c79" stop-opacity="0"/></linearGradient></defs>${[22,58,94,130].map(y=>`<line class="gridline" x1="35" y1="${y}" x2="635" y2="${y}"/>`).join('')}<path class="area" d="M${line} L${points.at(-1).x} 150 L${points[0].x} 150 Z"/><path class="line" d="M${line}"/>${points.map(p=>`<text class="axis" x="${p.x-12}" y="165">${esc(p.name.slice(0,10))}</text>`).join('')}</svg></div>`;
  };
  const originalOverview=window.renderOverview;
  window.renderOverview=function(c){originalOverview(c);if(window.schoolGetCurrent()?.role==='student')return;const d=state(),today=new Date().toISOString().slice(0,10),rows=(d.attendance||[]).filter(a=>a.date===today),present=rows.reduce((n,a)=>n+Number(a.present),0),absent=rows.reduce((n,a)=>n+Number(a.absent),0),count=d.users.filter(u=>u.role==='student'&&u.status==='Active').length,pending=d.users.filter(u=>u.role==='student'&&u.status==='Pending').length+(d.payments||[]).filter(p=>p.status==='Pending').length,rate=present+absent?Math.round(present*100/(present+absent)):0;const stats=c.querySelectorAll('.stats .stat');if(stats[0])stats[0].querySelector('.stat-num').textContent=count.toLocaleString();if(stats[1]){stats[1].querySelector('.stat-num').textContent=present.toLocaleString();stats[1].querySelector('.stat-foot').innerHTML=`<span class="up">${rate}%</span> recorded attendance`;}if(stats[3])stats[3].querySelector('.stat-num').textContent=pending;const ring=c.querySelector('.ring');if(ring){ring.querySelector('span').textContent=rate+'%';ring.style.background=`conic-gradient(#5a9473 0 ${rate}%,#edf0ec ${rate}% 100%)`;}const keys=c.querySelectorAll('.key-row b');if(keys[0])keys[0].textContent=present.toLocaleString()+' students';if(keys[1])keys[1].textContent=absent.toLocaleString()+' students';};
  window.renderAttendance=function(c){const d=state(),today=new Date().toISOString().slice(0,10),mine=d.classes.filter(x=>window.schoolGetCurrent()?.role!=='teacher'||x.teacher===window.schoolGetCurrent().name),rows=(d.attendance||[]).filter(a=>a.date===today),present=rows.reduce((n,a)=>n+Number(a.present),0),absent=rows.reduce((n,a)=>n+Number(a.absent),0),rate=present+absent?Math.round(present*100/(present+absent)):0;c.innerHTML=`${heading('Attendance','Daily attendance records, class reports, and follow-up.',action('✓ Mark class attendance',"openAttendance()"))}<div class="page-kpis"><div class="mini-kpi">Present today <b>${present}</b></div><div class="mini-kpi">Absent <b>${absent}</b></div><div class="mini-kpi">Recorded rate <b>${rate}%</b></div><div class="mini-kpi">Classes submitted <b>${rows.length} / ${mine.length}</b></div></div><div class="card table-card"><div class="table-toolbar"><h2>Class attendance · ${day(today)}</h2>${action('↓ Export report','exportAttendance()',true)}</div><div class="table-wrap"><table><thead><tr><th>CLASS</th><th>TEACHER</th><th>PRESENT</th><th>ABSENT</th><th>RATE</th><th>SUBMISSION</th><th></th></tr></thead><tbody>${mine.map(x=>{const a=rows.find(y=>y.className===x.name);return `<tr><td class="name">${esc(x.name)}</td><td>${esc(x.teacher)}</td><td>${a?`${a.present} / ${x.students}`:'—'}</td><td>${a?a.absent:'—'}</td><td>${a&&x.students?Math.round(100*a.present/x.students)+'%':'—'}</td><td>${badge(a?'Submitted':'Not submitted')}</td><td>${action('Mark',`openAttendance(${JSON.stringify(x.name)})`,true)}</td></tr>`}).join('')}</tbody></table></div></div>`;};

  // Secure exam submission: Postgres checks the time, grade and answer key.
  window.availableExams=()=>{const d=state(),me=window.schoolGetCurrent();return (d.exams||[]).filter(x=>x.grade===me.grade&&x.status==='Open'&&new Date(x.opens)<=new Date()&&(!x.closes||new Date(x.closes)>new Date())&&!x.results?.[me.authId])};
  window.startExam=id=>{const ex=state().exams.find(x=>x.id===id);if(!ex||!window.availableExams().some(x=>x.id===id))return say('This assessment is not available.');const end=Math.min(Date.now()+Number(ex.minutes)*60000,ex.closes?new Date(ex.closes).getTime():Infinity);const body=`<div class="exam-card" style="padding:0 0 12px"><span>Time remaining</span><b class="timer" id="examTimer"></b></div><form id="examForm">${ex.questions.map((q,i)=>`<div class="question"><h3>${i+1}. ${esc(q.text)}</h3>${q.options.map((o,j)=>`<label class="answer"><input type="radio" name="q${i}" value="${j}" required> ${esc(o)}</label>`).join('')}</div>`).join('')}</form><div class="modal-actions"><button class="button-sm" onclick="submitExam('${esc(id)}',false)">Submit exam</button></div>`;openModalHtml(ex.title,`${ex.subject} · ${ex.questions.length} questions`,body);const tick=()=>{const s=Math.max(0,Math.ceil((end-Date.now())/1000)),el=document.getElementById('examTimer');if(el)el.textContent=String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');if(s===0)window.submitExam(id,true)};clearInterval(window.__examClock);tick();window.__examClock=setInterval(tick,1000)};
  window.submitExam=async(id,auto)=>{const ex=state().exams.find(x=>x.id===id),form=document.getElementById('examForm');if(!form||!ex)return;const fd=new FormData(form),answers={};ex.questions.forEach((q,i)=>{if(fd.get('q'+i)!==null)answers[q.id]=Number(fd.get('q'+i))});if(!auto&&Object.keys(answers).length!==ex.questions.length)return say('Answer every question before submitting.');try{const {data,error}=await sb.rpc('submit_exam',{p_exam_id:id,p_answers:answers});if(error)throw error;clearInterval(window.__examClock);const r=Array.isArray(data)?data[0]:data;await reloadData();openModalHtml('Exam submitted',auto?'Time was up. Your answers were submitted automatically.':'Your assessment has been submitted.',`<div class="approval">Result: <b>${Number(r.score)}% (${r.correct_count}/${r.question_count} correct)</b>. This result has been saved to your school record.</div><div class="modal-actions"><button class="button-sm" onclick="closeModal();showPage('exams')">Done</button></div>`)}catch(e){say(e.message||'Could not submit exam.')}};

  async function approveAccount(id){if(!['admin','registrar'].includes(window.schoolGetCurrent()?.role))return say('Only school administrators or registrars can approve enrollment.');const {error}=await table(sb,'profiles').update({status:'Active'}).eq('student_number',id);if(error)return say(error.message);await reloadData();showPage('students');say('Student enrollment approved.')}
  async function createAccount(body){const {data,error}=await sb.functions.invoke('create-account',{body});if(error)throw error;return data}
  window.approveStudent=approveAccount;
  window.requestTranscript=async()=>{const me=window.schoolGetCurrent();try{const {error}=await table(sb,'profiles').update({transcript_status:'Pending'}).eq('id',me.authId);if(error)throw error;await reloadData();showPage('grades');say('Transcript review requested from the registrar.')}catch(e){say(e.message||'Could not request transcript review.')}};
  window.saveStudentForm=async editId=>{const f=document.getElementById('recordForm'),v=Object.fromEntries(new FormData(f).entries());if(!v.name||!v.email||!v.guardian)return say('Name, email, and guardian are required.');try{if(editId){const u=state().users.find(x=>x.id===editId);const {error}=await table(sb,'profiles').update({full_name:v.name,email:v.email,grade:v.grade,guardian:v.guardian,phone:v.phone,date_of_birth:v.dob||null,home_address:v.address||null,emergency_contact:v.emergency||null,room:v.room}).eq('id',u.authId);if(error)throw error}else{await createAccount({email:v.email,password:v.password||'school123',full_name:v.name,role:'student',status:document.getElementById('f_payment')?.value==='Paid'?'Active':'Pending',grade:v.grade,guardian:v.guardian,phone:v.phone,dob:v.dob,address:v.address,emergency:v.emergency,room:v.room})}closeModal();await reloadData();showPage('students');say(editId?'Student record updated.':'Student account created.')}catch(e){say(e.message||'Staff account service is not deployed yet.')}};
  window.saveStaff=async()=>{const f=document.getElementById('recordForm'),v=Object.fromEntries(new FormData(f).entries());if(!v.name||!v.email||!v.password)return say('Name, email, and password are required.');try{await createAccount({email:v.email,password:v.password,full_name:v.name,role:v.role,status:'Active',subject:v.subject,grade:v.grade,phone:v.phone});closeModal();await reloadData();showPage('staff');say('Staff account created.')}catch(e){say(e.message||'Staff account service is not deployed yet.')}};

  window.addEventListener('supabase-ready',async e=>{
    sb=e.detail;
    const login=document.getElementById('loginForm'),registration=document.getElementById('registerForm');
    login.onsubmit=signIn;registration.onsubmit=signUp;
    document.getElementById('demoFill').onclick=()=>say('Demo accounts are disabled. Sign in with an account created for this Supabase project.');
    const demo=document.querySelector('.demo-hint');if(demo)demo.innerHTML='<b>School account setup</b><span>Student enrollment requires registrar approval. The first administrator must be activated once in Supabase.</span><small>See <code>supabase/README.md</code> in the project folder.</small>';
    const {data:settings}=await table(sb,'school_settings').select('registration_open').eq('singleton',true).maybeSingle();
    if(settings?.registration_open===false){document.getElementById('registerTab').disabled=true;document.getElementById('registerTab').title='Student registration is currently closed';}
    const {data:{session}}=await sb.auth.getSession();if(session){try{loading=true;await hydrate();loading=false;window.enterPortal()}catch(err){loading=false;await sb.auth.signOut();say(err.message||'Please sign in again.')}}
  });

  const originalSave=window.save;
  window.save=function(){originalSave();if(sb&&!loading)scheduleSync()};
  window.logout=async()=>{if(sb)await sb.auth.signOut();window.schoolSetCurrent(null);document.getElementById('portal').hidden=true;document.getElementById('landing').hidden=false;document.getElementById('sidebar').classList.remove('open');authTab('login')};
})();
