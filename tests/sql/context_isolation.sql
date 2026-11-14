-- Deliberate final exception rolls back every fixture; unexpected exceptions are failures.
do $$
declare ua uuid:=gen_random_uuid(); ub uuid:=gen_random_uuid(); oa uuid; ob uuid; wa uuid; wb uuid; wa2 uuid; ca uuid; cb uuid; da uuid; rb uuid; n int; p int:=0;
begin
 insert into auth.users(id,email,aud,role,instance_id) values
 (ua,'context-a@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 (ub,'context-b@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
 perform set_config('request.jwt.claims',json_build_object('sub',ua,'role','authenticated')::text,true); execute 'set local role authenticated';
 oa:=public.create_organization('Context A','Workspace A'); select id into wa from public.workspaces where org_id=oa;
 insert into public.workspaces(org_id,name) values(oa,'Workspace A2') returning id into wa2;
 insert into public.conversations(org_id,workspace_id,user_id,title) values(oa,wa,ua,'Private A') returning id into ca;
 insert into public.documents(org_id,workspace_id,name,storage_path,mime,size_bytes,uploaded_by) values(oa,wa,'a.txt',oa::text||'/'||wa::text||'/a.txt','text/plain',5,ua) returning id into da;
 insert into public.business_facts(org_id,workspace_id,key,value,source_type,verified) values(oa,wa,'secret','A-only','user',true),(oa,wa2,'secret','A2-only','user',true),(oa,wa,'hypothesis','not evidence','ai_assumption',false);
 select count(*) into n from public.business_facts where org_id=oa and workspace_id=wa and verified;
 if n<>1 then raise exception 'verified filter failed'; end if; p:=p+1;
 select count(*) into n from public.documents where id=da and workspace_id=wa2;
 if n<>0 then raise exception 'scoped document lookup failed'; end if; p:=p+1;
 select count(*) into n from public.conversations where id=ca and workspace_id=wa2;
 if n<>0 then raise exception 'scoped conversation lookup failed'; end if; p:=p+1;
 begin update public.documents set storage_path=oa::text||'/'||wa2::text||'/secret.txt' where id=da; raise exception 'path mutation accepted'; exception when others then if sqlerrm not like 'Document storage%' then raise; end if; p:=p+1; end;
 begin insert into public.documents(org_id,workspace_id,name,storage_path,mime,size_bytes,uploaded_by) values(oa,wa,'bad.txt',oa::text||'/'||wa2::text||'/bad.txt','text/plain',5,ua); raise exception 'wrong path accepted'; exception when others then if sqlerrm not like 'Document storage%' then raise; end if; p:=p+1; end;
 execute 'reset role';
 perform set_config('request.jwt.claims',json_build_object('sub',ub,'role','authenticated')::text,true); execute 'set local role authenticated';
 ob:=public.create_organization('Context B','Workspace B'); select id into wb from public.workspaces where org_id=ob;
 insert into public.conversations(org_id,workspace_id,user_id,title) values(ob,wb,ub,'Private B') returning id into cb;
 insert into public.agent_runs(org_id,workspace_id,agent_key,user_id) values(ob,wb,'growth_officer',ub) returning id into rb;
 select count(*) into n from public.conversations where id=ca; if n<>0 then raise exception 'B reads A conversation'; end if; p:=p+1;
 select count(*) into n from public.documents where id=da; if n<>0 then raise exception 'B reads A document'; end if; p:=p+1;
 select count(*) into n from public.business_facts where workspace_id=wa; if n<>0 then raise exception 'B reads A memory'; end if; p:=p+1;
 begin insert into public.messages(org_id,conversation_id,role,content) values(ob,ca,'user','attack'); raise exception 'message scope accepted'; exception when others then if sqlerrm not like 'Conversation organization%' then raise; end if; p:=p+1; end;
 begin insert into public.agent_runs(org_id,workspace_id,agent_key,user_id) values(ob,wa,'growth_officer',ub); raise exception 'run scope accepted'; exception when others then if sqlerrm not like 'Workspace organization%' then raise; end if; p:=p+1; end;
 begin insert into public.approvals(org_id,workspace_id,run_id,capability_key,title,requested_by) values(ob,null,rb,'strategy.recommend','scope attack',ub); raise exception 'approval scope accepted'; exception when others then if sqlerrm not like 'Approval run scope%' then raise; end if; p:=p+1; end;
 execute 'reset role'; insert into public.organization_members(org_id,user_id,role) values(oa,ub,'admin');
 execute 'set local role authenticated';
 select count(*) into n from public.conversations where id=ca; if n<>0 then raise exception 'org admin reads another user conversation'; end if; p:=p+1;
 if public.has_platform_role('platform_owner') then raise exception 'org admin becomes platform owner'; end if; p:=p+1;
 execute 'reset role'; raise exception 'CONTEXT_RESULT pass=% fail=0',p;
end $$;