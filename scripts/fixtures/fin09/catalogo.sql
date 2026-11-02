with objetos as (
select 'table:'||c.relname as k,jsonb_build_object('owner',pg_get_userbyid(c.relowner),'acl',c.relacl,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'kind',c.relkind) as v from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p','v','S')
union all
select 'column:'||c.relname||'.'||a.attname,jsonb_build_object('type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'acl',a.attacl) from pg_attribute a join pg_class c on c.oid=a.attrelid left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where c.relnamespace='public'::regnamespace and a.attnum>0 and not a.attisdropped and c.relkind in ('r','p')
union all
select 'constraint:'||c.relname||'.'||x.conname,to_jsonb(pg_get_constraintdef(x.oid,true)) from pg_constraint x join pg_class c on c.oid=x.conrelid where c.relnamespace='public'::regnamespace
union all
select 'index:'||c.relname,to_jsonb(pg_get_indexdef(c.oid)) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='i'
union all
select 'trigger:'||c.relname||'.'||t.tgname,jsonb_build_object('def',pg_get_triggerdef(t.oid,true),'enabled',t.tgenabled) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and not t.tgisinternal
union all
select 'function:'||p.oid::regprocedure::text,jsonb_build_object('def',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl,'security_definer',p.prosecdef,'config',p.proconfig) from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f'
union all
select 'policy:'||tablename||'.'||policyname,to_jsonb(p)-'schemaname'-'tablename'-'policyname' from pg_policies p where schemaname='public'
union all
select 'dependency:'||pg_describe_object(d.classid,d.objid,d.objsubid)||' -> '||pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid)||':'||d.deptype::text,to_jsonb(d.deptype) from pg_depend d where (d.classid='pg_constraint'::regclass and d.objid in(select oid from pg_constraint where connamespace='public'::regnamespace)) or (d.classid='pg_proc'::regclass and d.objid in(select oid from pg_proc where pronamespace='public'::regnamespace))
)
select jsonb_object_agg(k,v order by k) from objetos;
