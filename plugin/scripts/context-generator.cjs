"use strict";var Dt=Object.create;var G=Object.defineProperty;var Mt=Object.getOwnPropertyDescriptor;var Ut=Object.getOwnPropertyNames;var xt=Object.getPrototypeOf,wt=Object.prototype.hasOwnProperty;var Pt=(r,e)=>{for(var t in e)G(r,t,{get:e[t],enumerable:!0})},Ne=(r,e,t,s)=>{if(e&&typeof e=="object"||typeof e=="function")for(let n of Ut(e))!wt.call(r,n)&&n!==t&&G(r,n,{get:()=>e[n],enumerable:!(s=Mt(e,n))||s.enumerable});return r};var x=(r,e,t)=>(t=r!=null?Dt(xt(r)):{},Ne(e||!r||!r.__esModule?G(t,"default",{value:r,enumerable:!0}):t,r)),kt=r=>Ne(G({},"__esModule",{value:!0}),r);var ls={};Pt(ls,{generateContext:()=>be});module.exports=kt(ls);var Lt=x(require("path"),1),vt=require("os"),yt=require("fs");var de=require("bun:sqlite");var T=require("path"),X=require("os"),D=require("fs");var Ie=require("url");var v=require("fs"),Ae=require("path");var te=(o=>(o[o.DEBUG=0]="DEBUG",o[o.INFO=1]="INFO",o[o.WARN=2]="WARN",o[o.ERROR=3]="ERROR",o[o.SILENT=4]="SILENT",o))(te||{}),se=class{level=null;useColor;logFilePath=null;logFileInitialized=!1;constructor(){this.useColor=process.stdout.isTTY??!1}ensureLogFileInitialized(){if(!this.logFileInitialized){this.logFileInitialized=!0;try{let e=w.logsDir();(0,v.existsSync)(e)||(0,v.mkdirSync)(e,{recursive:!0});let t=new Date().toISOString().split("T")[0];this.logFilePath=(0,Ae.join)(e,`claude-mem-plus-${t}.log`)}catch(e){console.error("[LOGGER] Failed to initialize log file:",e instanceof Error?e.message:String(e)),this.logFilePath=null}}}getLevel(){if(this.level===null)try{let e=w.settings();if((0,v.existsSync)(e)){let t=(0,v.readFileSync)(e,"utf-8"),n=(JSON.parse(t).CLAUDE_MEM_LOG_LEVEL||"INFO").toUpperCase();this.level=te[n]??1}else this.level=1}catch(e){console.error("[LOGGER] Failed to load log level from settings:",e instanceof Error?e.message:String(e)),this.level=1}return this.level}correlationId(e,t){return`obs-${e}-${t}`}sessionId(e){return`session-${e}`}formatData(e){if(e==null)return"";if(typeof e=="string")return e;if(typeof e=="number"||typeof e=="boolean")return e.toString();if(typeof e=="object"){if(e instanceof Error)return this.getLevel()===0?`${e.message}
${e.stack}`:e.message;if(Array.isArray(e))return`[${e.length} items]`;let t=Object.keys(e);return t.length===0?"{}":t.length<=3?JSON.stringify(e):`{${t.length} keys: ${t.slice(0,3).join(", ")}...}`}return String(e)}formatTool(e,t){if(!t)return e;let s=t;if(typeof t=="string")try{s=JSON.parse(t)}catch{s=t}if(e==="Bash"&&s.command)return`${e}(${s.command})`;if(s.file_path)return`${e}(${s.file_path})`;if(s.notebook_path)return`${e}(${s.notebook_path})`;if(e==="Glob"&&s.pattern)return`${e}(${s.pattern})`;if(e==="Grep"&&s.pattern)return`${e}(${s.pattern})`;if(s.url)return`${e}(${s.url})`;if(s.query)return`${e}(${s.query})`;if(e==="Task"){if(s.subagent_type)return`${e}(${s.subagent_type})`;if(s.description)return`${e}(${s.description})`}return e==="Skill"&&s.skill?`${e}(${s.skill})`:e==="LSP"&&s.operation?`${e}(${s.operation})`:e}formatTimestamp(e){let t=e.getFullYear(),s=String(e.getMonth()+1).padStart(2,"0"),n=String(e.getDate()).padStart(2,"0"),o=String(e.getHours()).padStart(2,"0"),i=String(e.getMinutes()).padStart(2,"0"),a=String(e.getSeconds()).padStart(2,"0"),d=String(e.getMilliseconds()).padStart(3,"0");return`${t}-${s}-${n} ${o}:${i}:${a}.${d}`}log(e,t,s,n,o){if(e<this.getLevel())return;this.ensureLogFileInitialized();let i=this.formatTimestamp(new Date),a=te[e].padEnd(5),d=t.padEnd(6),p="";n?.correlationId?p=`[${n.correlationId}] `:n?.sessionId&&(p=`[session-${n.sessionId}] `);let _="";if(o!=null)if(o instanceof Error)_=this.getLevel()===0?`
${o.message}
${o.stack}`:` ${o.message}`;else if(this.getLevel()===0&&typeof o=="object")try{_=`
`+JSON.stringify(o,null,2)}catch{_=" "+this.formatData(o)}else _=" "+this.formatData(o);let m="";if(n){let{sessionId:g,memorySessionId:h,correlationId:f,...l}=n;Object.keys(l).length>0&&(m=` {${Object.entries(l).map(([b,S])=>`${b}=${S}`).join(", ")}}`)}let E=`[${i}] [${a}] [${d}] ${p}${s}${m}${_}`;if(this.logFilePath)try{(0,v.appendFileSync)(this.logFilePath,E+`
`,"utf8")}catch(g){process.stderr.write(`[LOGGER] Failed to write to log file: ${g instanceof Error?g.message:String(g)}
`)}else process.stderr.write(E+`
`)}debug(e,t,s,n){this.log(0,e,t,s,n)}info(e,t,s,n){this.log(1,e,t,s,n)}warn(e,t,s,n){this.log(2,e,t,s,n)}error(e,t,s,n){this.log(3,e,t,s,n)}dataIn(e,t,s,n){this.info(e,`\u2192 ${t}`,s,n)}dataOut(e,t,s,n){this.info(e,`\u2190 ${t}`,s,n)}success(e,t,s,n){this.info(e,`\u2713 ${t}`,s,n)}failure(e,t,s,n){this.error(e,`\u2717 ${t}`,s,n)}timing(e,t,s,n){this.info(e,`\u23F1 ${t}`,n,{duration:`${s}ms`})}happyPathError(e,t,s,n,o=""){let p=((new Error().stack||"").split(`
`)[2]||"").match(/at\s+(?:.*\s+)?\(?([^:]+):(\d+):(\d+)\)?/),_=p?`${p[1].split("/").pop()}:${p[2]}`:"unknown",m={...s,location:_};return this.warn(e,`[HAPPY-PATH] ${t}`,m,n),o}},u=new se;var Yt={};function Ft(){return typeof __dirname<"u"?__dirname:(0,T.dirname)((0,Ie.fileURLToPath)(Yt.url))}var $t=Ft();function jt(){if(process.env.CLAUDE_MEM_DATA_DIR)return process.env.CLAUDE_MEM_DATA_DIR;let r=(0,T.join)((0,X.homedir)(),".claude-mem-plus"),e=(0,T.join)((0,X.homedir)(),".claude-mem");for(let t of[r,e]){let s=(0,T.join)(t,"settings.json");try{if((0,D.existsSync)(s)){let n=JSON.parse((0,D.readFileSync)(s,"utf-8")),o=n.env??n;return o.CLAUDE_MEM_DATA_DIR?o.CLAUDE_MEM_DATA_DIR:t}}catch{}}return r}var R=jt(),M=process.env.CLAUDE_CONFIG_DIR||(0,T.join)((0,X.homedir)(),".claude"),fs=(0,T.join)(M,"plugins","marketplaces","bjarne56"),Ht=(0,T.join)(R,"archives"),Gt=(0,T.join)(R,"logs"),Xt=(0,T.join)(R,"trash"),Bt=(0,T.join)(R,"backups"),Wt=(0,T.join)(R,"modes"),Ss=(0,T.join)(R,"settings.json"),re=(0,T.join)(R,"claude-mem.db"),Vt=(0,T.join)(R,"vector-db"),Ce=(0,T.join)(R,"observer-sessions"),ne=(0,T.basename)(Ce),bs=(0,T.join)(M,"settings.json"),Rs=(0,T.join)(M,"commands"),Os=(0,T.join)(M,"CLAUDE.md");function oe(r){(0,D.mkdirSync)(r,{recursive:!0})}function Le(){return(0,T.join)($t,"..")}var w={dataDir:()=>R,workerPid:()=>(0,T.join)(R,"worker.pid"),settings:()=>(0,T.join)(R,"settings.json"),database:()=>(0,T.join)(R,"claude-mem.db"),chroma:()=>(0,T.join)(R,"chroma"),combinedCerts:()=>(0,T.join)(R,"combined_certs.pem"),transcriptsConfig:()=>(0,T.join)(R,"transcript-watch.json"),transcriptsState:()=>(0,T.join)(R,"transcript-watch-state.json"),corpora:()=>(0,T.join)(R,"corpora"),supervisorRegistry:()=>(0,T.join)(R,"supervisor.json"),envFile:()=>(0,T.join)(R,".env"),logsDir:()=>Gt,archives:()=>Ht,trash:()=>Xt,backups:()=>Bt,modes:()=>Wt,vectorDb:()=>Vt,observerSessions:()=>Ce};var xe=require("crypto");var ye=require("os"),De=x(require("path"),1);var W=require("fs"),B=x(require("path"),1),P={isWorktree:!1,worktreeName:null,parentRepoPath:null,parentProjectName:null};function ve(r){let e=B.default.join(r,".git"),t;try{t=(0,W.statSync)(e)}catch(_){return _ instanceof Error&&_.code!=="ENOENT"&&console.warn("[worktree] Unexpected error checking .git:",_),P}if(!t.isFile())return P;let s;try{s=(0,W.readFileSync)(e,"utf-8").trim()}catch(_){return console.warn("[worktree] Failed to read .git file:",_ instanceof Error?_.message:String(_)),P}let n=s.match(/^gitdir:\s*(.+)$/);if(!n)return P;let i=n[1].match(/^(.+)[/\\]\.git[/\\]worktrees[/\\]([^/\\]+)$/);if(!i)return P;let a=i[1],d=B.default.basename(r),p=B.default.basename(a);return{isWorktree:!0,worktreeName:d,parentRepoPath:a,parentProjectName:p}}function Me(r){return r==="~"||r.startsWith("~/")?r.replace(/^~/,(0,ye.homedir)()):r}function Ue(r){if(!r||r.trim()==="")return u.warn("PROJECT_NAME","Empty cwd provided, using fallback",{cwd:r}),"unknown-project";let e=Me(r),t=De.default.basename(e);if(t===""){if(process.platform==="win32"){let n=r.match(/^([A-Z]):\\/i);if(n){let i=`drive-${n[1].toUpperCase()}`;return u.info("PROJECT_NAME","Drive root detected",{cwd:r,projectName:i}),i}}return u.warn("PROJECT_NAME","Root directory detected, using fallback",{cwd:r}),"unknown-project"}return t}function ie(r){let e=Ue(r);if(!r)return{primary:e,parent:null,isWorktree:!1,allProjects:[e]};let t=Me(r),s=ve(t);if(s.isWorktree&&s.parentProjectName){let n=`${s.parentProjectName}/${e}`;return{primary:n,parent:s.parentProjectName,isWorktree:!0,allProjects:[s.parentProjectName,n]}}return{primary:e,parent:null,isWorktree:!1,allProjects:[e]}}var qt=require("bun:sqlite");function V(r,e,t){return(0,xe.createHash)("sha256").update([r||"",e||"",t||""].join("\0")).digest("hex").slice(0,16)}function ae(r){if(!r)return[];try{let e=JSON.parse(r);return Array.isArray(e)?e:[String(e)]}catch{return[r]}}var I="claude";function Kt(r){return r.trim().toLowerCase().replace(/\s+/g,"-")}function U(r){if(!r)return I;let e=Kt(r);return e?e==="transcript"||e.includes("codex")?"codex":e.includes("cursor")?"cursor":e.includes("claude")?"claude":e:I}function we(r){let e=["claude","codex","cursor"];return[...r].sort((t,s)=>{let n=e.indexOf(t),o=e.indexOf(s);return n!==-1||o!==-1?n===-1?1:o===-1?-1:n-o:t.localeCompare(s)})}function Jt(r,e){return{customTitle:r,platformSource:e?U(e):void 0}}var Y=class{db;constructor(e=re){e instanceof de.Database?this.db=e:(e!==":memory:"&&oe(R),this.db=new de.Database(e),this.db.run("PRAGMA journal_mode = WAL"),this.db.run("PRAGMA synchronous = NORMAL"),this.db.run("PRAGMA foreign_keys = ON"),this.db.run("PRAGMA journal_size_limit = 4194304")),this.initializeSchema(),this.ensureWorkerPortColumn(),this.ensurePromptTrackingColumns(),this.removeSessionSummariesUniqueConstraint(),this.addObservationHierarchicalFields(),this.makeObservationsTextNullable(),this.createUserPromptsTable(),this.ensureDiscoveryTokensColumn(),this.createPendingMessagesTable(),this.renameSessionIdColumns(),this.repairSessionIdColumnRename(),this.addFailedAtEpochColumn(),this.addOnUpdateCascadeToForeignKeys(),this.addObservationContentHashColumn(),this.addSessionCustomTitleColumn(),this.addSessionPlatformSourceColumn(),this.addObservationModelColumns(),this.ensureMergedIntoProjectColumns(),this.addObservationSubagentColumns(),this.addObservationsUniqueContentHashIndex(),this.addObservationsMetadataColumn(),this.dropDeadPendingMessagesColumns(),this.ensurePendingMessagesToolUseIdColumn(),this.dropWorkerPidColumn(),this.ensureProjectsTables(),this.migrateProjectIdToInt()}migrateProjectIdToInt(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(34))return;if(this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'").all().length===0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(34,new Date().toISOString());return}let n=this.db.query("PRAGMA table_info(projects)").all().find(p=>p.name==="id");if(n&&n.type?.toUpperCase().startsWith("INTEGER")){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(34,new Date().toISOString());return}u.info("DB","[migration v34] \u9879\u76EE ID \u4ECE TEXT(p_xxx)\u8FC1\u5230 INTEGER(8 \u4F4D\u6570\u5B57)\u5F00\u59CB");let o=1e7,i=99999999,a=new Set,d=()=>{for(let p=0;p<1e3;p++){let _=Math.floor(o+Math.random()*(i-o+1));if(!a.has(_))return a.add(_),_}throw new Error("Failed to allocate 8-digit project ID after 1000 retries")};this.db.transaction(()=>{this.db.run(`CREATE TEMP TABLE _project_id_map (
        old_id TEXT PRIMARY KEY,
        new_id INTEGER NOT NULL UNIQUE
      )`);let p=this.db.prepare("SELECT id FROM projects").all(),_=this.db.prepare("INSERT INTO _project_id_map (old_id, new_id) VALUES (?, ?)");for(let f of p)_.run(f.id,d());this.db.run(`CREATE TABLE projects_new (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        anchor_path TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`),this.db.run(`INSERT INTO projects_new (id, name, anchor_path, created_at, updated_at)
                   SELECT m.new_id, p.name, p.anchor_path, p.created_at, p.updated_at
                   FROM projects p JOIN _project_id_map m ON m.old_id = p.id`),this.db.run(`CREATE TABLE project_paths_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects_new(id) ON DELETE CASCADE,
        path TEXT NOT NULL UNIQUE,
        added_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      )`),this.db.run(`INSERT INTO project_paths_new (id, project_id, path, added_at, last_seen_at)
                   SELECT pp.id, m.new_id, pp.path, pp.added_at, pp.last_seen_at
                   FROM project_paths pp JOIN _project_id_map m ON m.old_id = pp.project_id`);let m=f=>{let l=this.db.query(`PRAGMA table_info(${f})`).all();return l.length===0||!l.some(b=>b.name==="project_id")?0:this.db.prepare(`
          UPDATE ${f} SET project_id = (SELECT new_id FROM _project_id_map WHERE old_id = ${f}.project_id)
          WHERE project_id IS NOT NULL AND project_id IN (SELECT old_id FROM _project_id_map)
        `).run().changes},E=m("observations"),g=m("session_summaries"),h=m("sdk_sessions");this.db.run("DROP TABLE project_paths"),this.db.run("DROP TABLE projects"),this.db.run("ALTER TABLE projects_new RENAME TO projects"),this.db.run("ALTER TABLE project_paths_new RENAME TO project_paths"),this.db.run("CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_project_paths_project ON project_paths(project_id)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_project_paths_path ON project_paths(path)"),this.db.run("DROP TABLE _project_id_map"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(34,new Date().toISOString()),u.info("DB",`[migration v34] \u5B8C\u6210: ${p.length} projects \u91CD ID,\u5F15\u7528\u66F4\u65B0 obs=${E} sum=${g} sess=${h}`)})()}ensureProjectsTables(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(33))return;this.db.run(`
      CREATE TABLE IF NOT EXISTS projects (
        id           TEXT    PRIMARY KEY,
        name         TEXT    NOT NULL UNIQUE,
        anchor_path  TEXT,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL
      )
    `),this.db.run("CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name)"),this.db.run(`
      CREATE TABLE IF NOT EXISTS project_paths (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id    TEXT    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        path          TEXT    NOT NULL UNIQUE,
        added_at      INTEGER NOT NULL,
        last_seen_at  INTEGER NOT NULL
      )
    `),this.db.run("CREATE INDEX IF NOT EXISTS idx_project_paths_project ON project_paths(project_id)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_project_paths_path ON project_paths(path)");let t=s=>{let n=this.db.query(`PRAGMA table_info(${s})`).all();n.length!==0&&(n.some(o=>o.name==="project_id")||(this.db.run(`ALTER TABLE ${s} ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL`),this.db.run(`CREATE INDEX IF NOT EXISTS idx_${s}_project_id ON ${s}(project_id)`)))};t("observations"),t("session_summaries"),t("sdk_sessions"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(33,new Date().toISOString()),u.info("DB","Created projects/project_paths tables and project_id columns (schema v33)")}dropWorkerPidColumn(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(32),s=this.db.query("PRAGMA table_info(pending_messages)").all().some(n=>n.name==="worker_pid");if(!(e&&!s)){if(s)try{this.db.run("DROP INDEX IF EXISTS idx_pending_messages_worker_pid"),this.db.run("ALTER TABLE pending_messages DROP COLUMN worker_pid"),u.debug("DB","Dropped worker_pid column and its index from pending_messages")}catch(n){u.warn("DB","Failed to drop worker_pid column from pending_messages",{},n instanceof Error?n:new Error(String(n)));return}e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(32,new Date().toISOString())}}dropDeadPendingMessagesColumns(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(31),t=this.db.query("PRAGMA table_info(pending_messages)").all(),s=new Set(t.map(i=>i.name)),o=["retry_count","failed_at_epoch","completed_at_epoch"].filter(i=>s.has(i));if(!(e&&o.length===0)){if(o.length>0){this.db.run("BEGIN TRANSACTION");try{this.db.run("DELETE FROM pending_messages WHERE status NOT IN ('pending', 'processing')");for(let i of o)this.db.run(`ALTER TABLE pending_messages DROP COLUMN ${i}`),u.debug("DB",`Dropped dead column ${i} from pending_messages`);e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(31,new Date().toISOString()),this.db.run("COMMIT")}catch(i){this.db.run("ROLLBACK"),u.warn("DB","Failed to drop dead columns from pending_messages",{},i instanceof Error?i:new Error(String(i)));return}return}e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(31,new Date().toISOString())}}initializeSchema(){this.db.run(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        id INTEGER PRIMARY KEY,
        version INTEGER UNIQUE NOT NULL,
        applied_at TEXT NOT NULL
      )
    `),this.db.run(`
      CREATE TABLE IF NOT EXISTS sdk_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content_session_id TEXT UNIQUE NOT NULL,
        memory_session_id TEXT UNIQUE,
        project TEXT NOT NULL,
        platform_source TEXT NOT NULL DEFAULT 'claude',
        user_prompt TEXT,
        started_at TEXT NOT NULL,
        started_at_epoch INTEGER NOT NULL,
        completed_at TEXT,
        completed_at_epoch INTEGER,
        status TEXT CHECK(status IN ('active', 'completed', 'failed')) NOT NULL DEFAULT 'active'
      );

      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_claude_id ON sdk_sessions(content_session_id);
      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_sdk_id ON sdk_sessions(memory_session_id);
      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_project ON sdk_sessions(project);
      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_status ON sdk_sessions(status);
      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_started ON sdk_sessions(started_at_epoch DESC);

      CREATE TABLE IF NOT EXISTS observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        text TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE ON UPDATE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_observations_sdk_session ON observations(memory_session_id);
      CREATE INDEX IF NOT EXISTS idx_observations_project ON observations(project);
      CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(type);
      CREATE INDEX IF NOT EXISTS idx_observations_created ON observations(created_at_epoch DESC);

      CREATE TABLE IF NOT EXISTS session_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT UNIQUE NOT NULL,
        project TEXT NOT NULL,
        request TEXT,
        investigated TEXT,
        learned TEXT,
        completed TEXT,
        next_steps TEXT,
        files_read TEXT,
        files_edited TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE ON UPDATE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_session_summaries_sdk_session ON session_summaries(memory_session_id);
      CREATE INDEX IF NOT EXISTS idx_session_summaries_project ON session_summaries(project);
      CREATE INDEX IF NOT EXISTS idx_session_summaries_created ON session_summaries(created_at_epoch DESC);
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(4,new Date().toISOString())}ensureWorkerPortColumn(){this.db.query("PRAGMA table_info(sdk_sessions)").all().some(s=>s.name==="worker_port")||(this.db.run("ALTER TABLE sdk_sessions ADD COLUMN worker_port INTEGER"),u.debug("DB","Added worker_port column to sdk_sessions table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(5,new Date().toISOString())}ensurePromptTrackingColumns(){this.db.query("PRAGMA table_info(sdk_sessions)").all().some(a=>a.name==="prompt_counter")||(this.db.run("ALTER TABLE sdk_sessions ADD COLUMN prompt_counter INTEGER DEFAULT 0"),u.debug("DB","Added prompt_counter column to sdk_sessions table")),this.db.query("PRAGMA table_info(observations)").all().some(a=>a.name==="prompt_number")||(this.db.run("ALTER TABLE observations ADD COLUMN prompt_number INTEGER"),u.debug("DB","Added prompt_number column to observations table")),this.db.query("PRAGMA table_info(session_summaries)").all().some(a=>a.name==="prompt_number")||(this.db.run("ALTER TABLE session_summaries ADD COLUMN prompt_number INTEGER"),u.debug("DB","Added prompt_number column to session_summaries table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(6,new Date().toISOString())}removeSessionSummariesUniqueConstraint(){if(!this.db.query("PRAGMA index_list(session_summaries)").all().some(s=>s.unique===1&&s.origin!=="pk")){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(7,new Date().toISOString());return}u.debug("DB","Removing UNIQUE constraint from session_summaries.memory_session_id"),this.db.run("BEGIN TRANSACTION"),this.db.run("DROP TABLE IF EXISTS session_summaries_new"),this.db.run(`
      CREATE TABLE session_summaries_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        request TEXT,
        investigated TEXT,
        learned TEXT,
        completed TEXT,
        next_steps TEXT,
        files_read TEXT,
        files_edited TEXT,
        notes TEXT,
        prompt_number INTEGER,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE
      )
    `),this.db.run(`
      INSERT INTO session_summaries_new
      SELECT id, memory_session_id, project, request, investigated, learned,
             completed, next_steps, files_read, files_edited, notes,
             prompt_number, created_at, created_at_epoch
      FROM session_summaries
    `),this.db.run("DROP TABLE session_summaries"),this.db.run("ALTER TABLE session_summaries_new RENAME TO session_summaries"),this.db.run(`
      CREATE INDEX idx_session_summaries_sdk_session ON session_summaries(memory_session_id);
      CREATE INDEX idx_session_summaries_project ON session_summaries(project);
      CREATE INDEX idx_session_summaries_created ON session_summaries(created_at_epoch DESC);
    `),this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(7,new Date().toISOString()),u.debug("DB","Successfully removed UNIQUE constraint from session_summaries.memory_session_id")}addObservationHierarchicalFields(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(8))return;if(this.db.query("PRAGMA table_info(observations)").all().some(n=>n.name==="title")){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(8,new Date().toISOString());return}u.debug("DB","Adding hierarchical fields to observations table"),this.db.run(`
      ALTER TABLE observations ADD COLUMN title TEXT;
      ALTER TABLE observations ADD COLUMN subtitle TEXT;
      ALTER TABLE observations ADD COLUMN facts TEXT;
      ALTER TABLE observations ADD COLUMN narrative TEXT;
      ALTER TABLE observations ADD COLUMN concepts TEXT;
      ALTER TABLE observations ADD COLUMN files_read TEXT;
      ALTER TABLE observations ADD COLUMN files_modified TEXT;
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(8,new Date().toISOString()),u.debug("DB","Successfully added hierarchical fields to observations table")}makeObservationsTextNullable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(9))return;let s=this.db.query("PRAGMA table_info(observations)").all().find(n=>n.name==="text");if(!s||s.notnull===0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(9,new Date().toISOString());return}u.debug("DB","Making observations.text nullable"),this.db.run("BEGIN TRANSACTION"),this.db.run("DROP TABLE IF EXISTS observations_new"),this.db.run(`
      CREATE TABLE observations_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        text TEXT,
        type TEXT NOT NULL,
        title TEXT,
        subtitle TEXT,
        facts TEXT,
        narrative TEXT,
        concepts TEXT,
        files_read TEXT,
        files_modified TEXT,
        prompt_number INTEGER,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE
      )
    `),this.db.run(`
      INSERT INTO observations_new
      SELECT id, memory_session_id, project, text, type, title, subtitle, facts,
             narrative, concepts, files_read, files_modified, prompt_number,
             created_at, created_at_epoch
      FROM observations
    `),this.db.run("DROP TABLE observations"),this.db.run("ALTER TABLE observations_new RENAME TO observations"),this.db.run(`
      CREATE INDEX idx_observations_sdk_session ON observations(memory_session_id);
      CREATE INDEX idx_observations_project ON observations(project);
      CREATE INDEX idx_observations_type ON observations(type);
      CREATE INDEX idx_observations_created ON observations(created_at_epoch DESC);
    `),this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(9,new Date().toISOString()),u.debug("DB","Successfully made observations.text nullable")}createUserPromptsTable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(10))return;if(this.db.query("PRAGMA table_info(user_prompts)").all().length>0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(10,new Date().toISOString());return}u.debug("DB","Creating user_prompts table with FTS5 support"),this.db.run("BEGIN TRANSACTION"),this.db.run(`
      CREATE TABLE user_prompts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content_session_id TEXT NOT NULL,
        prompt_number INTEGER NOT NULL,
        prompt_text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(content_session_id) REFERENCES sdk_sessions(content_session_id) ON DELETE CASCADE
      );

      CREATE INDEX idx_user_prompts_claude_session ON user_prompts(content_session_id);
      CREATE INDEX idx_user_prompts_created ON user_prompts(created_at_epoch DESC);
      CREATE INDEX idx_user_prompts_prompt_number ON user_prompts(prompt_number);
      CREATE INDEX idx_user_prompts_lookup ON user_prompts(content_session_id, prompt_number);
    `);let s=`
      CREATE VIRTUAL TABLE user_prompts_fts USING fts5(
        prompt_text,
        content='user_prompts',
        content_rowid='id'
      );
    `,n=`
      CREATE TRIGGER user_prompts_ai AFTER INSERT ON user_prompts BEGIN
        INSERT INTO user_prompts_fts(rowid, prompt_text)
        VALUES (new.id, new.prompt_text);
      END;

      CREATE TRIGGER user_prompts_ad AFTER DELETE ON user_prompts BEGIN
        INSERT INTO user_prompts_fts(user_prompts_fts, rowid, prompt_text)
        VALUES('delete', old.id, old.prompt_text);
      END;

      CREATE TRIGGER user_prompts_au AFTER UPDATE ON user_prompts BEGIN
        INSERT INTO user_prompts_fts(user_prompts_fts, rowid, prompt_text)
        VALUES('delete', old.id, old.prompt_text);
        INSERT INTO user_prompts_fts(rowid, prompt_text)
        VALUES (new.id, new.prompt_text);
      END;
    `;try{this.db.run(s),this.db.run(n)}catch(o){o instanceof Error?u.warn("DB","FTS5 not available \u2014 user_prompts_fts skipped (search uses ChromaDB)",{},o):u.warn("DB","FTS5 not available \u2014 user_prompts_fts skipped (search uses ChromaDB)",{},new Error(String(o))),this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(10,new Date().toISOString()),u.debug("DB","Created user_prompts table (without FTS5)");return}this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(10,new Date().toISOString()),u.debug("DB","Successfully created user_prompts table")}ensureDiscoveryTokensColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(11))return;this.db.query("PRAGMA table_info(observations)").all().some(i=>i.name==="discovery_tokens")||(this.db.run("ALTER TABLE observations ADD COLUMN discovery_tokens INTEGER DEFAULT 0"),u.debug("DB","Added discovery_tokens column to observations table")),this.db.query("PRAGMA table_info(session_summaries)").all().some(i=>i.name==="discovery_tokens")||(this.db.run("ALTER TABLE session_summaries ADD COLUMN discovery_tokens INTEGER DEFAULT 0"),u.debug("DB","Added discovery_tokens column to session_summaries table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(11,new Date().toISOString())}createPendingMessagesTable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(16))return;if(this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='pending_messages'").all().length>0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(16,new Date().toISOString());return}u.debug("DB","Creating pending_messages table"),this.db.run(`
      CREATE TABLE pending_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_db_id INTEGER NOT NULL,
        content_session_id TEXT NOT NULL,
        message_type TEXT NOT NULL CHECK(message_type IN ('observation', 'summarize')),
        tool_name TEXT,
        tool_input TEXT,
        tool_response TEXT,
        cwd TEXT,
        last_user_message TEXT,
        last_assistant_message TEXT,
        prompt_number INTEGER,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing')),
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY (session_db_id) REFERENCES sdk_sessions(id) ON DELETE CASCADE
      )
    `),this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_session ON pending_messages(session_db_id)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_status ON pending_messages(status)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_claude_session ON pending_messages(content_session_id)"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(16,new Date().toISOString()),u.debug("DB","pending_messages table created successfully")}renameSessionIdColumns(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(17))return;u.debug("DB","Checking session ID columns for semantic clarity rename");let t=0,s=(n,o,i)=>{let a=this.db.query(`PRAGMA table_info(${n})`).all(),d=a.some(_=>_.name===o);return a.some(_=>_.name===i)?!1:d?(this.db.run(`ALTER TABLE ${n} RENAME COLUMN ${o} TO ${i}`),u.debug("DB",`Renamed ${n}.${o} to ${i}`),!0):(u.warn("DB",`Column ${o} not found in ${n}, skipping rename`),!1)};s("sdk_sessions","claude_session_id","content_session_id")&&t++,s("sdk_sessions","sdk_session_id","memory_session_id")&&t++,s("pending_messages","claude_session_id","content_session_id")&&t++,s("observations","sdk_session_id","memory_session_id")&&t++,s("session_summaries","sdk_session_id","memory_session_id")&&t++,s("user_prompts","claude_session_id","content_session_id")&&t++,this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(17,new Date().toISOString()),t>0?u.debug("DB",`Successfully renamed ${t} session ID columns`):u.debug("DB","No session ID column renames needed (already up to date)")}repairSessionIdColumnRename(){this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(19)||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(19,new Date().toISOString())}addFailedAtEpochColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(20))return;this.db.query("PRAGMA table_info(pending_messages)").all().some(n=>n.name==="failed_at_epoch")||(this.db.run("ALTER TABLE pending_messages ADD COLUMN failed_at_epoch INTEGER"),u.debug("DB","Added failed_at_epoch column to pending_messages table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(20,new Date().toISOString())}addOnUpdateCascadeToForeignKeys(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(21))return;u.debug("DB","Adding ON UPDATE CASCADE to FK constraints on observations and session_summaries"),this.db.run("PRAGMA foreign_keys = OFF"),this.db.run("BEGIN TRANSACTION"),this.db.run("DROP TRIGGER IF EXISTS observations_ai"),this.db.run("DROP TRIGGER IF EXISTS observations_ad"),this.db.run("DROP TRIGGER IF EXISTS observations_au"),this.db.run("DROP TABLE IF EXISTS observations_new");let s=this.db.query("PRAGMA table_info(observations)").all().some(h=>h.name==="metadata"),n=s?`,
        metadata TEXT`:"",o=s?", metadata":"",i=`
      CREATE TABLE observations_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        text TEXT,
        type TEXT NOT NULL,
        title TEXT,
        subtitle TEXT,
        facts TEXT,
        narrative TEXT,
        concepts TEXT,
        files_read TEXT,
        files_modified TEXT,
        prompt_number INTEGER,
        discovery_tokens INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL${n},
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE ON UPDATE CASCADE
      )
    `,a=`
      INSERT INTO observations_new
      SELECT id, memory_session_id, project, text, type, title, subtitle, facts,
             narrative, concepts, files_read, files_modified, prompt_number,
             discovery_tokens, created_at, created_at_epoch${o}
      FROM observations
    `,d=`
      CREATE INDEX idx_observations_sdk_session ON observations(memory_session_id);
      CREATE INDEX idx_observations_project ON observations(project);
      CREATE INDEX idx_observations_type ON observations(type);
      CREATE INDEX idx_observations_created ON observations(created_at_epoch DESC);
    `,p=`
      CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations BEGIN
        INSERT INTO observations_fts(rowid, title, subtitle, narrative, text, facts, concepts)
        VALUES (new.id, new.title, new.subtitle, new.narrative, new.text, new.facts, new.concepts);
      END;

      CREATE TRIGGER IF NOT EXISTS observations_ad AFTER DELETE ON observations BEGIN
        INSERT INTO observations_fts(observations_fts, rowid, title, subtitle, narrative, text, facts, concepts)
        VALUES('delete', old.id, old.title, old.subtitle, old.narrative, old.text, old.facts, old.concepts);
      END;

      CREATE TRIGGER IF NOT EXISTS observations_au AFTER UPDATE ON observations BEGIN
        INSERT INTO observations_fts(observations_fts, rowid, title, subtitle, narrative, text, facts, concepts)
        VALUES('delete', old.id, old.title, old.subtitle, old.narrative, old.text, old.facts, old.concepts);
        INSERT INTO observations_fts(rowid, title, subtitle, narrative, text, facts, concepts)
        VALUES (new.id, new.title, new.subtitle, new.narrative, new.text, new.facts, new.concepts);
      END;
    `;this.db.run("DROP TRIGGER IF EXISTS session_summaries_ai"),this.db.run("DROP TRIGGER IF EXISTS session_summaries_ad"),this.db.run("DROP TRIGGER IF EXISTS session_summaries_au"),this.db.run("DROP TABLE IF EXISTS session_summaries_new");let _=`
      CREATE TABLE session_summaries_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        request TEXT,
        investigated TEXT,
        learned TEXT,
        completed TEXT,
        next_steps TEXT,
        files_read TEXT,
        files_edited TEXT,
        notes TEXT,
        prompt_number INTEGER,
        discovery_tokens INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE ON UPDATE CASCADE
      )
    `,m=`
      INSERT INTO session_summaries_new
      SELECT id, memory_session_id, project, request, investigated, learned,
             completed, next_steps, files_read, files_edited, notes,
             prompt_number, discovery_tokens, created_at, created_at_epoch
      FROM session_summaries
    `,E=`
      CREATE INDEX idx_session_summaries_sdk_session ON session_summaries(memory_session_id);
      CREATE INDEX idx_session_summaries_project ON session_summaries(project);
      CREATE INDEX idx_session_summaries_created ON session_summaries(created_at_epoch DESC);
    `,g=`
      CREATE TRIGGER IF NOT EXISTS session_summaries_ai AFTER INSERT ON session_summaries BEGIN
        INSERT INTO session_summaries_fts(rowid, request, investigated, learned, completed, next_steps, notes)
        VALUES (new.id, new.request, new.investigated, new.learned, new.completed, new.next_steps, new.notes);
      END;

      CREATE TRIGGER IF NOT EXISTS session_summaries_ad AFTER DELETE ON session_summaries BEGIN
        INSERT INTO session_summaries_fts(session_summaries_fts, rowid, request, investigated, learned, completed, next_steps, notes)
        VALUES('delete', old.id, old.request, old.investigated, old.learned, old.completed, old.next_steps, old.notes);
      END;

      CREATE TRIGGER IF NOT EXISTS session_summaries_au AFTER UPDATE ON session_summaries BEGIN
        INSERT INTO session_summaries_fts(session_summaries_fts, rowid, request, investigated, learned, completed, next_steps, notes)
        VALUES('delete', old.id, old.request, old.investigated, old.learned, old.completed, old.next_steps, old.notes);
        INSERT INTO session_summaries_fts(rowid, request, investigated, learned, completed, next_steps, notes)
        VALUES (new.id, new.request, new.investigated, new.learned, new.completed, new.next_steps, new.notes);
      END;
    `;try{this.recreateObservationsWithCascade(i,a,d,p),this.recreateSessionSummariesWithCascade(_,m,E,g),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(21,new Date().toISOString()),this.db.run("COMMIT"),this.db.run("PRAGMA foreign_keys = ON"),u.debug("DB","Successfully added ON UPDATE CASCADE to FK constraints")}catch(h){throw this.db.run("ROLLBACK"),this.db.run("PRAGMA foreign_keys = ON"),h instanceof Error?h:new Error(String(h))}}recreateObservationsWithCascade(e,t,s,n){this.db.run(e),this.db.run(t),this.db.run("DROP TABLE observations"),this.db.run("ALTER TABLE observations_new RENAME TO observations"),this.db.run(s),this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='observations_fts'").all().length>0&&this.db.run(n)}recreateSessionSummariesWithCascade(e,t,s,n){this.db.run(e),this.db.run(t),this.db.run("DROP TABLE session_summaries"),this.db.run("ALTER TABLE session_summaries_new RENAME TO session_summaries"),this.db.run(s),this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_summaries_fts'").all().length>0&&this.db.run(n)}addObservationContentHashColumn(){if(this.db.query("PRAGMA table_info(observations)").all().some(s=>s.name==="content_hash")){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(22,new Date().toISOString());return}this.db.run("ALTER TABLE observations ADD COLUMN content_hash TEXT"),this.db.run("UPDATE observations SET content_hash = substr(hex(randomblob(8)), 1, 16) WHERE content_hash IS NULL"),this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_content_hash ON observations(content_hash, created_at_epoch)"),u.debug("DB","Added content_hash column to observations table with backfill and index"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(22,new Date().toISOString())}addSessionCustomTitleColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(23))return;this.db.query("PRAGMA table_info(sdk_sessions)").all().some(n=>n.name==="custom_title")||(this.db.run("ALTER TABLE sdk_sessions ADD COLUMN custom_title TEXT"),u.debug("DB","Added custom_title column to sdk_sessions table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(23,new Date().toISOString())}addSessionPlatformSourceColumn(){let t=this.db.query("PRAGMA table_info(sdk_sessions)").all().some(i=>i.name==="platform_source"),n=this.db.query("PRAGMA index_list(sdk_sessions)").all().some(i=>i.name==="idx_sdk_sessions_platform_source");this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(24)&&t&&n||(t||(this.db.run(`ALTER TABLE sdk_sessions ADD COLUMN platform_source TEXT NOT NULL DEFAULT '${I}'`),u.debug("DB","Added platform_source column to sdk_sessions table")),this.db.run(`
      UPDATE sdk_sessions
      SET platform_source = '${I}'
      WHERE platform_source IS NULL OR platform_source = ''
    `),n||this.db.run("CREATE INDEX IF NOT EXISTS idx_sdk_sessions_platform_source ON sdk_sessions(platform_source)"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(24,new Date().toISOString()))}addObservationModelColumns(){let e=this.db.query("PRAGMA table_info(observations)").all(),t=e.some(n=>n.name==="generated_by_model"),s=e.some(n=>n.name==="relevance_count");t&&s||(t||this.db.run("ALTER TABLE observations ADD COLUMN generated_by_model TEXT"),s||this.db.run("ALTER TABLE observations ADD COLUMN relevance_count INTEGER DEFAULT 0"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(26,new Date().toISOString()))}ensureMergedIntoProjectColumns(){this.db.query("PRAGMA table_info(observations)").all().some(s=>s.name==="merged_into_project")||this.db.run("ALTER TABLE observations ADD COLUMN merged_into_project TEXT"),this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_merged_into ON observations(merged_into_project)"),this.db.query("PRAGMA table_info(session_summaries)").all().some(s=>s.name==="merged_into_project")||this.db.run("ALTER TABLE session_summaries ADD COLUMN merged_into_project TEXT"),this.db.run("CREATE INDEX IF NOT EXISTS idx_summaries_merged_into ON session_summaries(merged_into_project)")}addObservationSubagentColumns(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(27),t=this.db.query("PRAGMA table_info(observations)").all(),s=t.some(i=>i.name==="agent_type"),n=t.some(i=>i.name==="agent_id");s||this.db.run("ALTER TABLE observations ADD COLUMN agent_type TEXT"),n||this.db.run("ALTER TABLE observations ADD COLUMN agent_id TEXT"),this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_agent_type ON observations(agent_type)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_agent_id ON observations(agent_id)");let o=this.db.query("PRAGMA table_info(pending_messages)").all();if(o.length>0){let i=o.some(d=>d.name==="agent_type"),a=o.some(d=>d.name==="agent_id");i||this.db.run("ALTER TABLE pending_messages ADD COLUMN agent_type TEXT"),a||this.db.run("ALTER TABLE pending_messages ADD COLUMN agent_id TEXT")}e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(27,new Date().toISOString())}ensurePendingMessagesToolUseIdColumn(){if(this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='pending_messages'").all().length===0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(28,new Date().toISOString());return}this.db.query("PRAGMA table_info(pending_messages)").all().some(n=>n.name==="tool_use_id")||this.db.run("ALTER TABLE pending_messages ADD COLUMN tool_use_id TEXT"),this.db.run("BEGIN TRANSACTION");try{this.db.run(`
        DELETE FROM pending_messages
         WHERE id IN (
           SELECT id
             FROM (
               SELECT id,
                      ROW_NUMBER() OVER (
                        PARTITION BY content_session_id, tool_use_id
                        ORDER BY CASE status
                          WHEN 'processing' THEN 0
                          WHEN 'pending' THEN 1
                          ELSE 2
                        END, id
                      ) AS duplicate_rank
                 FROM pending_messages
                WHERE tool_use_id IS NOT NULL
             )
            WHERE duplicate_rank > 1
           )
      `),this.db.run(`
        -- tool_use_id is optional for summaries and legacy rows; enforce de-dupe
        -- only for rows that came from a concrete tool-use event.
        CREATE UNIQUE INDEX IF NOT EXISTS ux_pending_session_tool
        ON pending_messages(content_session_id, tool_use_id)
        WHERE tool_use_id IS NOT NULL
      `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(28,new Date().toISOString()),this.db.run("COMMIT")}catch(n){throw this.db.run("ROLLBACK"),n}}addObservationsUniqueContentHashIndex(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(29))return;let t=this.db.query("PRAGMA table_info(observations)").all(),s=t.some(o=>o.name==="memory_session_id"),n=t.some(o=>o.name==="content_hash");if(!s||!n){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(29,new Date().toISOString());return}this.db.run("BEGIN TRANSACTION");try{this.db.run(`
        DELETE FROM observations
         WHERE id NOT IN (
           SELECT MIN(id) FROM observations
            GROUP BY memory_session_id, content_hash
         )
      `),this.db.run(`
        CREATE UNIQUE INDEX IF NOT EXISTS ux_observations_session_hash
        ON observations(memory_session_id, content_hash)
      `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(29,new Date().toISOString()),this.db.run("COMMIT")}catch(o){throw this.db.run("ROLLBACK"),o}}addObservationsMetadataColumn(){this.db.query("PRAGMA table_info(observations)").all().some(s=>s.name==="metadata")||(this.db.run("ALTER TABLE observations ADD COLUMN metadata TEXT"),u.debug("DB","Added metadata column to observations table (#2116)")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(30,new Date().toISOString())}updateMemorySessionId(e,t){this.db.prepare(`
      UPDATE sdk_sessions
      SET memory_session_id = ?
      WHERE id = ?
    `).run(t,e)}markSessionCompleted(e){let t=Date.now(),s=new Date(t).toISOString();this.db.prepare(`
      UPDATE sdk_sessions
      SET status = 'completed', completed_at = ?, completed_at_epoch = ?
      WHERE id = ?
    `).run(s,t,e)}ensureMemorySessionIdRegistered(e,t){let s=this.db.prepare(`
      SELECT id, memory_session_id FROM sdk_sessions WHERE id = ?
    `).get(e);if(!s)throw new Error(`Session ${e} not found in sdk_sessions`);s.memory_session_id!==t&&(this.db.prepare(`
        UPDATE sdk_sessions SET memory_session_id = ? WHERE id = ?
      `).run(t,e),u.info("DB","Registered memory_session_id before storage (FK fix)",{sessionDbId:e,oldId:s.memory_session_id,newId:t}))}getRecentSummaries(e,t=10){return this.db.prepare(`
      SELECT
        request, investigated, learned, completed, next_steps,
        files_read, files_edited, notes, prompt_number, created_at
      FROM session_summaries
      WHERE project = ?
      ORDER BY created_at_epoch DESC
      LIMIT ?
    `).all(e,t)}getRecentSummariesWithSessionInfo(e,t=3){return this.db.prepare(`
      SELECT
        memory_session_id, request, learned, completed, next_steps,
        prompt_number, created_at
      FROM session_summaries
      WHERE project = ?
      ORDER BY created_at_epoch DESC
      LIMIT ?
    `).all(e,t)}getRecentObservations(e,t=20){return this.db.prepare(`
      SELECT type, text, prompt_number, created_at
      FROM observations
      WHERE project = ?
      ORDER BY created_at_epoch DESC
      LIMIT ?
    `).all(e,t)}getAllRecentObservations(e=100){return this.db.prepare(`
      SELECT
        o.id,
        o.type,
        o.title,
        o.subtitle,
        o.text,
        o.project,
        COALESCE(s.platform_source, '${I}') as platform_source,
        o.prompt_number,
        o.created_at,
        o.created_at_epoch
      FROM observations o
      LEFT JOIN sdk_sessions s ON o.memory_session_id = s.memory_session_id
      ORDER BY o.created_at_epoch DESC
      LIMIT ?
    `).all(e)}getAllRecentSummaries(e=50){return this.db.prepare(`
      SELECT
        ss.id,
        ss.request,
        ss.investigated,
        ss.learned,
        ss.completed,
        ss.next_steps,
        ss.files_read,
        ss.files_edited,
        ss.notes,
        ss.project,
        COALESCE(s.platform_source, '${I}') as platform_source,
        ss.prompt_number,
        ss.created_at,
        ss.created_at_epoch
      FROM session_summaries ss
      LEFT JOIN sdk_sessions s ON ss.memory_session_id = s.memory_session_id
      ORDER BY ss.created_at_epoch DESC
      LIMIT ?
    `).all(e)}getAllRecentUserPrompts(e=100){return this.db.prepare(`
      SELECT
        up.id,
        up.content_session_id,
        s.project,
        COALESCE(s.platform_source, '${I}') as platform_source,
        up.prompt_number,
        up.prompt_text,
        up.created_at,
        up.created_at_epoch
      FROM user_prompts up
      LEFT JOIN sdk_sessions s ON up.content_session_id = s.content_session_id
      ORDER BY up.created_at_epoch DESC
      LIMIT ?
    `).all(e)}getAllProjects(e){let t=e?U(e):void 0,s=`
      SELECT DISTINCT project
      FROM sdk_sessions
      WHERE project IS NOT NULL AND project != ''
        AND project != ?
    `,n=[ne];return t&&(s+=" AND COALESCE(platform_source, ?) = ?",n.push(I,t)),s+=" ORDER BY project ASC",this.db.prepare(s).all(...n).map(i=>i.project)}getProjectCatalog(){let e=this.db.prepare(`
      SELECT
        COALESCE(platform_source, '${I}') as platform_source,
        project,
        MAX(started_at_epoch) as latest_epoch
      FROM sdk_sessions
      WHERE project IS NOT NULL AND project != ''
        AND project != ?
      GROUP BY COALESCE(platform_source, '${I}'), project
      ORDER BY latest_epoch DESC
    `).all(ne),t=[],s=new Set,n={};for(let i of e){let a=U(i.platform_source);n[a]||(n[a]=[]),n[a].includes(i.project)||n[a].push(i.project),s.has(i.project)||(s.add(i.project),t.push(i.project))}let o=we(Object.keys(n));return{projects:t,sources:o,projectsBySource:Object.fromEntries(o.map(i=>[i,n[i]||[]]))}}getLatestUserPrompt(e){return this.db.prepare(`
      SELECT
        up.*,
        s.memory_session_id,
        s.project,
        COALESCE(s.platform_source, '${I}') as platform_source
      FROM user_prompts up
      JOIN sdk_sessions s ON up.content_session_id = s.content_session_id
      WHERE up.content_session_id = ?
      ORDER BY up.created_at_epoch DESC
      LIMIT 1
    `).get(e)}getRecentSessionsWithStatus(e,t=3){return this.db.prepare(`
      SELECT * FROM (
        SELECT
          s.memory_session_id,
          s.status,
          s.started_at,
          s.started_at_epoch,
          s.user_prompt,
          CASE WHEN sum.memory_session_id IS NOT NULL THEN 1 ELSE 0 END as has_summary
        FROM sdk_sessions s
        LEFT JOIN session_summaries sum ON s.memory_session_id = sum.memory_session_id
        WHERE s.project = ? AND s.memory_session_id IS NOT NULL
        GROUP BY s.memory_session_id
        ORDER BY s.started_at_epoch DESC
        LIMIT ?
      )
      ORDER BY started_at_epoch ASC
    `).all(e,t)}getObservationsForSession(e){return this.db.prepare(`
      SELECT title, subtitle, type, prompt_number
      FROM observations
      WHERE memory_session_id = ?
      ORDER BY created_at_epoch ASC
    `).all(e)}getObservationById(e){return this.db.prepare(`
      SELECT *
      FROM observations
      WHERE id = ?
    `).get(e)||null}getObservationsByIds(e,t={}){if(e.length===0)return[];let{orderBy:s="date_desc",limit:n,project:o,type:i,concepts:a,files:d}=t,p=s==="relevance",_=p?"":`ORDER BY created_at_epoch ${s==="date_asc"?"ASC":"DESC"}`,m=n?`LIMIT ${n}`:"",E=e.map(()=>"?").join(","),g=[...e],h=[];if(o&&(h.push("project = ?"),g.push(o)),i)if(Array.isArray(i)){let S=i.map(()=>"?").join(",");h.push(`type IN (${S})`),g.push(...i)}else h.push("type = ?"),g.push(i);if(a){let S=Array.isArray(a)?a:[a],A=S.map(()=>"EXISTS (SELECT 1 FROM json_each(concepts) WHERE value = ?)");g.push(...S),h.push(`(${A.join(" OR ")})`)}if(d){let S=Array.isArray(d)?d:[d],A=S.map(()=>"(EXISTS (SELECT 1 FROM json_each(files_read) WHERE value LIKE ?) OR EXISTS (SELECT 1 FROM json_each(files_modified) WHERE value LIKE ?))");S.forEach(y=>{g.push(`%${y}%`,`%${y}%`)}),h.push(`(${A.join(" OR ")})`)}let f=h.length>0?`WHERE id IN (${E}) AND ${h.join(" AND ")}`:`WHERE id IN (${E})`,N=this.db.prepare(`
      SELECT *
      FROM observations
      ${f}
      ${_}
      ${m}
    `).all(...g);if(!p)return N;let b=new Map(N.map(S=>[S.id,S]));return e.map(S=>b.get(S)).filter(S=>!!S)}getSummaryForSession(e){return this.db.prepare(`
      SELECT
        request, investigated, learned, completed, next_steps,
        files_read, files_edited, notes, prompt_number, created_at,
        created_at_epoch
      FROM session_summaries
      WHERE memory_session_id = ?
      ORDER BY created_at_epoch DESC
      LIMIT 1
    `).get(e)||null}getFilesForSession(e){let s=this.db.prepare(`
      SELECT files_read, files_modified
      FROM observations
      WHERE memory_session_id = ?
    `).all(e),n=new Set,o=new Set;for(let i of s)ae(i.files_read).forEach(a=>n.add(a)),ae(i.files_modified).forEach(a=>o.add(a));return{filesRead:Array.from(n),filesModified:Array.from(o)}}getSessionById(e){return this.db.prepare(`
      SELECT id, content_session_id, memory_session_id, project,
             COALESCE(platform_source, '${I}') as platform_source,
             user_prompt, custom_title, status
      FROM sdk_sessions
      WHERE id = ?
      LIMIT 1
    `).get(e)||null}getSdkSessionsBySessionIds(e){if(e.length===0)return[];let t=e.map(()=>"?").join(",");return this.db.prepare(`
      SELECT id, content_session_id, memory_session_id, project,
             COALESCE(platform_source, '${I}') as platform_source,
             user_prompt, custom_title,
             started_at, started_at_epoch, completed_at, completed_at_epoch, status
      FROM sdk_sessions
      WHERE memory_session_id IN (${t})
      ORDER BY started_at_epoch DESC
    `).all(...e)}getPromptNumberFromUserPrompts(e){return this.db.prepare(`
      SELECT COUNT(*) as count FROM user_prompts WHERE content_session_id = ?
    `).get(e).count}createSDKSession(e,t,s,n,o){let i=new Date,a=i.getTime(),d=Jt(n,o),p=d.platformSource??I,_=this.db.prepare(`
      SELECT id, platform_source FROM sdk_sessions WHERE content_session_id = ?
    `).get(e);if(_){if(t&&this.db.prepare(`
          UPDATE sdk_sessions SET project = ?
          WHERE content_session_id = ? AND (project IS NULL OR project = '')
        `).run(t,e),d.customTitle&&this.db.prepare(`
          UPDATE sdk_sessions SET custom_title = ?
          WHERE content_session_id = ? AND custom_title IS NULL
        `).run(d.customTitle,e),d.platformSource){let E=_.platform_source?.trim()?U(_.platform_source):void 0;if(!E)this.db.prepare(`
            UPDATE sdk_sessions SET platform_source = ?
            WHERE content_session_id = ?
              AND COALESCE(platform_source, '') = ''
          `).run(d.platformSource,e);else if(E!==d.platformSource)throw new Error(`Platform source conflict for session ${e}: existing=${E}, received=${d.platformSource}`)}return _.id}return this.db.prepare(`
      INSERT INTO sdk_sessions
      (content_session_id, memory_session_id, project, platform_source, user_prompt, custom_title, started_at, started_at_epoch, status)
      VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'active')
    `).run(e,t,p,s,d.customTitle||null,i.toISOString(),a),this.db.prepare("SELECT id FROM sdk_sessions WHERE content_session_id = ?").get(e).id}saveUserPrompt(e,t,s){let n=new Date,o=n.getTime();return this.db.prepare(`
      INSERT INTO user_prompts
      (content_session_id, prompt_number, prompt_text, created_at, created_at_epoch)
      VALUES (?, ?, ?, ?, ?)
    `).run(e,t,s,n.toISOString(),o).lastInsertRowid}getUserPrompt(e,t){return this.db.prepare(`
      SELECT prompt_text
      FROM user_prompts
      WHERE content_session_id = ? AND prompt_number = ?
      LIMIT 1
    `).get(e,t)?.prompt_text??null}storeObservation(e,t,s,n,o=0,i,a){let d=i??Date.now(),p=new Date(d).toISOString(),_=V(e,s.title,s.narrative),E=this.db.prepare(`
      INSERT INTO observations
      (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
       files_read, files_modified, prompt_number, discovery_tokens, agent_type, agent_id, content_hash, created_at, created_at_epoch,
       generated_by_model, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(memory_session_id, content_hash) DO NOTHING
      RETURNING id, created_at_epoch
    `).get(e,t,s.type,s.title,s.subtitle,JSON.stringify(s.facts),s.narrative,JSON.stringify(s.concepts),JSON.stringify(s.files_read),JSON.stringify(s.files_modified),n||null,o,s.agent_type??null,s.agent_id??null,_,p,d,a||null,s.metadata??null);if(E)return{id:E.id,createdAtEpoch:E.created_at_epoch};let g=this.db.prepare("SELECT id, created_at_epoch FROM observations WHERE memory_session_id = ? AND content_hash = ?").get(e,_);if(!g)throw new Error(`storeObservation: ON CONFLICT without existing row for content_hash=${_}`);return{id:g.id,createdAtEpoch:g.created_at_epoch}}storeSummary(e,t,s,n,o=0,i){let a=i??Date.now(),d=new Date(a).toISOString(),_=this.db.prepare(`
      INSERT INTO session_summaries
      (memory_session_id, project, request, investigated, learned, completed,
       next_steps, notes, prompt_number, discovery_tokens, created_at, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e,t,s.request,s.investigated,s.learned,s.completed,s.next_steps,s.notes,n||null,o,d,a);return{id:Number(_.lastInsertRowid),createdAtEpoch:a}}storeObservations(e,t,s,n,o,i=0,a,d){let p=a??Date.now(),_=new Date(p).toISOString();return this.db.transaction(()=>{let E=[],g=this.db.prepare(`
        INSERT INTO observations
        (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
         files_read, files_modified, prompt_number, discovery_tokens, agent_type, agent_id, content_hash, created_at, created_at_epoch,
         generated_by_model)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(memory_session_id, content_hash) DO NOTHING
        RETURNING id
      `),h=this.db.prepare("SELECT id FROM observations WHERE memory_session_id = ? AND content_hash = ?");for(let l of s){let N=V(e,l.title,l.narrative),b=g.get(e,t,l.type,l.title,l.subtitle,JSON.stringify(l.facts),l.narrative,JSON.stringify(l.concepts),JSON.stringify(l.files_read),JSON.stringify(l.files_modified),o||null,i,l.agent_type??null,l.agent_id??null,N,_,p,d||null);if(b){E.push(b.id);continue}let S=h.get(e,N);if(!S)throw new Error(`storeObservations: ON CONFLICT without existing row for content_hash=${N}`);E.push(S.id)}let f=null;if(n){let N=this.db.prepare(`
          INSERT INTO session_summaries
          (memory_session_id, project, request, investigated, learned, completed,
           next_steps, notes, prompt_number, discovery_tokens, created_at, created_at_epoch)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(e,t,n.request,n.investigated,n.learned,n.completed,n.next_steps,n.notes,o||null,i,_,p);f=Number(N.lastInsertRowid)}return{observationIds:E,summaryId:f,createdAtEpoch:p}})()}storeObservationsAndMarkComplete(e,t,s,n,o,i,a,d=0,p,_){let m=p??Date.now(),E=new Date(m).toISOString();return this.db.transaction(()=>{let h=[],f=this.db.prepare(`
        INSERT INTO observations
        (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
         files_read, files_modified, prompt_number, discovery_tokens, agent_type, agent_id, content_hash, created_at, created_at_epoch,
         generated_by_model)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(memory_session_id, content_hash) DO NOTHING
        RETURNING id
      `),l=this.db.prepare("SELECT id FROM observations WHERE memory_session_id = ? AND content_hash = ?");for(let A of s){let y=V(e,A.title,A.narrative),Re=f.get(e,t,A.type,A.title,A.subtitle,JSON.stringify(A.facts),A.narrative,JSON.stringify(A.concepts),JSON.stringify(A.files_read),JSON.stringify(A.files_modified),a||null,d,A.agent_type??null,A.agent_id??null,y,E,m,_||null);if(Re){h.push(Re.id);continue}let Oe=l.get(e,y);if(!Oe)throw new Error(`storeObservationsAndMarkComplete: ON CONFLICT without existing row for content_hash=${y}`);h.push(Oe.id)}let N;if(n){let y=this.db.prepare(`
          INSERT INTO session_summaries
          (memory_session_id, project, request, investigated, learned, completed,
           next_steps, notes, prompt_number, discovery_tokens, created_at, created_at_epoch)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(e,t,n.request,n.investigated,n.learned,n.completed,n.next_steps,n.notes,a||null,d,E,m);N=Number(y.lastInsertRowid)}if(this.db.prepare(`
        DELETE FROM pending_messages
        WHERE id = ? AND status = 'processing'
      `).run(o).changes!==1)throw new Error(`storeObservationsAndMarkComplete: failed to complete pending message ${o}`);return{observationIds:h,summaryId:N,createdAtEpoch:m}})()}getSessionSummariesByIds(e,t={}){if(e.length===0)return[];let{orderBy:s="date_desc",limit:n,project:o}=t,i=s==="relevance",a=i?"":`ORDER BY created_at_epoch ${s==="date_asc"?"ASC":"DESC"}`,d=n?`LIMIT ${n}`:"",p=e.map(()=>"?").join(","),_=[...e],m=o?`WHERE id IN (${p}) AND project = ?`:`WHERE id IN (${p})`;o&&_.push(o);let g=this.db.prepare(`
      SELECT * FROM session_summaries
      ${m}
      ${a}
      ${d}
    `).all(..._);if(!i)return g;let h=new Map(g.map(f=>[f.id,f]));return e.map(f=>h.get(f)).filter(f=>!!f)}getUserPromptsByIds(e,t={}){if(e.length===0)return[];let{orderBy:s="date_desc",limit:n,project:o}=t,i=s==="relevance",a=i?"":`ORDER BY up.created_at_epoch ${s==="date_asc"?"ASC":"DESC"}`,d=n?`LIMIT ${n}`:"",p=e.map(()=>"?").join(","),_=[...e],m=o?"AND s.project = ?":"";o&&_.push(o);let g=this.db.prepare(`
      SELECT
        up.*,
        s.project,
        s.memory_session_id
      FROM user_prompts up
      JOIN sdk_sessions s ON up.content_session_id = s.content_session_id
      WHERE up.id IN (${p}) ${m}
      ${a}
      ${d}
    `).all(..._);if(!i)return g;let h=new Map(g.map(f=>[f.id,f]));return e.map(f=>h.get(f)).filter(f=>!!f)}getTimelineAroundTimestamp(e,t=10,s=10,n){return this.getTimelineAroundObservation(null,e,t,s,n)}getTimelineAroundObservation(e,t,s=10,n=10,o){let i=o?"AND project = ?":"",a=o?[o]:[],d,p;if(e!==null){let l=`
        SELECT id, created_at_epoch
        FROM observations
        WHERE id <= ? ${i}
        ORDER BY id DESC
        LIMIT ?
      `,N=`
        SELECT id, created_at_epoch
        FROM observations
        WHERE id >= ? ${i}
        ORDER BY id ASC
        LIMIT ?
      `;try{let b=this.db.prepare(l).all(e,...a,s+1),S=this.db.prepare(N).all(e,...a,n+1);if(b.length===0&&S.length===0)return{observations:[],sessions:[],prompts:[]};d=b.length>0?b[b.length-1].created_at_epoch:t,p=S.length>0?S[S.length-1].created_at_epoch:t}catch(b){return b instanceof Error?u.error("DB","Error getting boundary observations",{project:o},b):u.error("DB","Error getting boundary observations with non-Error",{},new Error(String(b))),{observations:[],sessions:[],prompts:[]}}}else{let l=`
        SELECT created_at_epoch
        FROM observations
        WHERE created_at_epoch <= ? ${i}
        ORDER BY created_at_epoch DESC
        LIMIT ?
      `,N=`
        SELECT created_at_epoch
        FROM observations
        WHERE created_at_epoch >= ? ${i}
        ORDER BY created_at_epoch ASC
        LIMIT ?
      `;try{let b=this.db.prepare(l).all(t,...a,s),S=this.db.prepare(N).all(t,...a,n+1);if(b.length===0&&S.length===0)return{observations:[],sessions:[],prompts:[]};d=b.length>0?b[b.length-1].created_at_epoch:t,p=S.length>0?S[S.length-1].created_at_epoch:t}catch(b){return b instanceof Error?u.error("DB","Error getting boundary timestamps",{project:o},b):u.error("DB","Error getting boundary timestamps with non-Error",{},new Error(String(b))),{observations:[],sessions:[],prompts:[]}}}let _=`
      SELECT *
      FROM observations
      WHERE created_at_epoch >= ? AND created_at_epoch <= ? ${i}
      ORDER BY created_at_epoch ASC
    `,m=`
      SELECT *
      FROM session_summaries
      WHERE created_at_epoch >= ? AND created_at_epoch <= ? ${i}
      ORDER BY created_at_epoch ASC
    `,E=`
      SELECT up.*, s.project, s.memory_session_id
      FROM user_prompts up
      JOIN sdk_sessions s ON up.content_session_id = s.content_session_id
      WHERE up.created_at_epoch >= ? AND up.created_at_epoch <= ? ${i.replace("project","s.project")}
      ORDER BY up.created_at_epoch ASC
    `,g=this.db.prepare(_).all(d,p,...a),h=this.db.prepare(m).all(d,p,...a),f=this.db.prepare(E).all(d,p,...a);return{observations:g,sessions:h.map(l=>({id:l.id,memory_session_id:l.memory_session_id,project:l.project,request:l.request,completed:l.completed,next_steps:l.next_steps,created_at:l.created_at,created_at_epoch:l.created_at_epoch})),prompts:f.map(l=>({id:l.id,content_session_id:l.content_session_id,prompt_number:l.prompt_number,prompt_text:l.prompt_text,project:l.project,created_at:l.created_at,created_at_epoch:l.created_at_epoch}))}}getPromptById(e){return this.db.prepare(`
      SELECT
        p.id,
        p.content_session_id,
        p.prompt_number,
        p.prompt_text,
        s.project,
        p.created_at,
        p.created_at_epoch
      FROM user_prompts p
      LEFT JOIN sdk_sessions s ON p.content_session_id = s.content_session_id
      WHERE p.id = ?
      LIMIT 1
    `).get(e)||null}getPromptsByIds(e){if(e.length===0)return[];let t=e.map(()=>"?").join(",");return this.db.prepare(`
      SELECT
        p.id,
        p.content_session_id,
        p.prompt_number,
        p.prompt_text,
        s.project,
        p.created_at,
        p.created_at_epoch
      FROM user_prompts p
      LEFT JOIN sdk_sessions s ON p.content_session_id = s.content_session_id
      WHERE p.id IN (${t})
      ORDER BY p.created_at_epoch DESC
    `).all(...e)}getSessionSummaryById(e){return this.db.prepare(`
      SELECT
        id,
        memory_session_id,
        content_session_id,
        project,
        user_prompt,
        request_summary,
        learned_summary,
        status,
        created_at,
        created_at_epoch
      FROM sdk_sessions
      WHERE id = ?
      LIMIT 1
    `).get(e)||null}getOrCreateManualSession(e){let t=`manual-${e}`,s=`manual-content-${e}`;if(this.db.prepare("SELECT memory_session_id FROM sdk_sessions WHERE memory_session_id = ?").get(t))return t;let o=new Date;return this.db.prepare(`
      INSERT INTO sdk_sessions (memory_session_id, content_session_id, project, platform_source, started_at, started_at_epoch, status)
      VALUES (?, ?, ?, ?, ?, ?, 'active')
    `).run(t,s,e,I,o.toISOString(),o.getTime()),u.info("SESSION","Created manual session",{memorySessionId:t,project:e}),t}close(){this.db.close()}importSdkSession(e){let t=this.db.prepare("SELECT id FROM sdk_sessions WHERE content_session_id = ?").get(e.content_session_id);return t?{imported:!1,id:t.id}:{imported:!0,id:this.db.prepare(`
      INSERT INTO sdk_sessions (
        content_session_id, memory_session_id, project, platform_source, user_prompt,
        started_at, started_at_epoch, completed_at, completed_at_epoch, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e.content_session_id,e.memory_session_id,e.project,U(e.platform_source),e.user_prompt,e.started_at,e.started_at_epoch,e.completed_at,e.completed_at_epoch,e.status).lastInsertRowid}}importSessionSummary(e){let t=this.db.prepare("SELECT id FROM session_summaries WHERE memory_session_id = ?").get(e.memory_session_id);return t?{imported:!1,id:t.id}:{imported:!0,id:this.db.prepare(`
      INSERT INTO session_summaries (
        memory_session_id, project, request, investigated, learned,
        completed, next_steps, files_read, files_edited, notes,
        prompt_number, discovery_tokens, created_at, created_at_epoch
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e.memory_session_id,e.project,e.request,e.investigated,e.learned,e.completed,e.next_steps,e.files_read,e.files_edited,e.notes,e.prompt_number,e.discovery_tokens||0,e.created_at,e.created_at_epoch).lastInsertRowid}}importObservation(e){let t=this.db.prepare(`
      SELECT id FROM observations
      WHERE memory_session_id = ? AND title = ? AND created_at_epoch = ?
    `).get(e.memory_session_id,e.title,e.created_at_epoch);return t?{imported:!1,id:t.id}:{imported:!0,id:this.db.prepare(`
      INSERT INTO observations (
        memory_session_id, project, text, type, title, subtitle,
        facts, narrative, concepts, files_read, files_modified,
        prompt_number, discovery_tokens, agent_type, agent_id,
        created_at, created_at_epoch
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e.memory_session_id,e.project,e.text,e.type,e.title,e.subtitle,e.facts,e.narrative,e.concepts,e.files_read,e.files_modified,e.prompt_number,e.discovery_tokens||0,e.agent_type??null,e.agent_id??null,e.created_at,e.created_at_epoch).lastInsertRowid}}rebuildObservationsFTSIndex(){this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='observations_fts'").all().length>0&&this.db.run("INSERT INTO observations_fts(observations_fts) VALUES('rebuild')")}importUserPrompt(e){let t=this.db.prepare(`
      SELECT id FROM user_prompts
      WHERE content_session_id = ? AND prompt_number = ?
    `).get(e.content_session_id,e.prompt_number);return t?{imported:!1,id:t.id}:{imported:!0,id:this.db.prepare(`
      INSERT INTO user_prompts (
        content_session_id, prompt_number, prompt_text,
        created_at, created_at_epoch
      ) VALUES (?, ?, ?, ?, ?)
    `).run(e.content_session_id,e.prompt_number,e.prompt_text,e.created_at,e.created_at_epoch).lastInsertRowid}}};var L=require("fs"),k=require("path"),ce=require("os"),q=class{static DEFAULTS={CLAUDE_MEM_MODEL:"claude-haiku-4-5-20251001",CLAUDE_MEM_CONTEXT_OBSERVATIONS:"50",CLAUDE_MEM_WORKER_PORT:"37777",CLAUDE_MEM_WORKER_HOST:"127.0.0.1",CLAUDE_MEM_SKIP_TOOLS:"ListMcpResourcesTool,SlashCommand,Skill,TodoWrite,AskUserQuestion,Bash",CLAUDE_MEM_PROVIDER:"claude",CLAUDE_MEM_CLAUDE_AUTH_METHOD:"subscription",CLAUDE_MEM_GEMINI_API_KEY:"",CLAUDE_MEM_GEMINI_MODEL:"gemini-2.5-flash-lite",CLAUDE_MEM_GEMINI_RATE_LIMITING_ENABLED:"true",CLAUDE_MEM_GEMINI_MAX_CONTEXT_MESSAGES:"20",CLAUDE_MEM_GEMINI_MAX_TOKENS:"100000",CLAUDE_MEM_OPENROUTER_API_KEY:"",CLAUDE_MEM_OPENROUTER_MODEL:"xiaomi/mimo-v2-flash:free",CLAUDE_MEM_OPENROUTER_SITE_URL:"",CLAUDE_MEM_OPENROUTER_APP_NAME:"claude-mem-plus",CLAUDE_MEM_OPENROUTER_MAX_CONTEXT_MESSAGES:"20",CLAUDE_MEM_OPENROUTER_MAX_TOKENS:"100000",CLAUDE_MEM_DATA_DIR:(0,k.join)((0,ce.homedir)(),".claude-mem-plus"),CLAUDE_MEM_LOG_LEVEL:"INFO",CLAUDE_MEM_PYTHON_VERSION:"3.13",CLAUDE_CODE_PATH:"",CLAUDE_MEM_MODE:"code",CLAUDE_MEM_CONTEXT_SHOW_READ_TOKENS:"true",CLAUDE_MEM_CONTEXT_SHOW_WORK_TOKENS:"true",CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT:"true",CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_PERCENT:"true",CLAUDE_MEM_CONTEXT_FULL_COUNT:"5",CLAUDE_MEM_CONTEXT_FULL_FIELD:"narrative",CLAUDE_MEM_CONTEXT_SESSION_COUNT:"10",CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY:"true",CLAUDE_MEM_CONTEXT_SHOW_LAST_MESSAGE:"true",CLAUDE_MEM_CONTEXT_SHOW_TERMINAL_OUTPUT:"true",CLAUDE_MEM_WELCOME_HINT_ENABLED:"true",CLAUDE_MEM_FOLDER_CLAUDEMD_ENABLED:"true",CLAUDE_MEM_FOLDER_USE_LOCAL_MD:"false",CLAUDE_MEM_TRANSCRIPTS_ENABLED:"true",CLAUDE_MEM_TRANSCRIPTS_CONFIG_PATH:(0,k.join)((0,ce.homedir)(),".claude-mem-plus","transcript-watch.json"),CLAUDE_MEM_MAX_CONCURRENT_AGENTS:"2",CLAUDE_MEM_HOOK_FAIL_LOUD_THRESHOLD:"3",CLAUDE_MEM_EXCLUDED_PROJECTS:"",CLAUDE_MEM_FOLDER_MD_EXCLUDE:"[]",CLAUDE_MEM_SEMANTIC_INJECT:"true",CLAUDE_MEM_SEMANTIC_INJECT_LIMIT:"5",CLAUDE_MEM_TIER_ROUTING_ENABLED:"true",CLAUDE_MEM_TIER_SIMPLE_MODEL:"haiku",CLAUDE_MEM_TIER_SUMMARY_MODEL:"",CLAUDE_MEM_CHROMA_ENABLED:"true",CLAUDE_MEM_CHROMA_MODE:"local",CLAUDE_MEM_CHROMA_HOST:"127.0.0.1",CLAUDE_MEM_CHROMA_PORT:"8000",CLAUDE_MEM_CHROMA_SSL:"false",CLAUDE_MEM_CHROMA_API_KEY:"",CLAUDE_MEM_CHROMA_TENANT:"default_tenant",CLAUDE_MEM_CHROMA_DATABASE:"default_database",CLAUDE_MEM_TELEGRAM_ENABLED:"false",CLAUDE_MEM_TELEGRAM_BOT_TOKEN:"",CLAUDE_MEM_TELEGRAM_CHAT_ID:"",CLAUDE_MEM_TELEGRAM_TRIGGER_TYPES:"security_alert",CLAUDE_MEM_TELEGRAM_TRIGGER_CONCEPTS:""};static getAllDefaults(){return{...this.DEFAULTS}}static get(e){return process.env[e]??this.DEFAULTS[e]}static getInt(e){let t=this.get(e);return parseInt(t,10)}static getBool(e){let t=this.get(e);return t==="true"||t===!0}static applyEnvOverrides(e){let t={...e};for(let s of Object.keys(this.DEFAULTS))process.env[s]!==void 0&&(t[s]=process.env[s]);return t}static loadFromFile(e){try{if(!(0,L.existsSync)(e)){let i=this.getAllDefaults();try{let a=(0,k.dirname)(e);(0,L.existsSync)(a)||(0,L.mkdirSync)(a,{recursive:!0}),(0,L.writeFileSync)(e,JSON.stringify(i,null,2),"utf-8"),console.log("[SETTINGS] Created settings file with defaults:",e)}catch(a){console.warn("[SETTINGS] Failed to create settings file, using in-memory defaults:",e,a instanceof Error?a.message:String(a))}return this.applyEnvOverrides(i)}let t=(0,L.readFileSync)(e,"utf-8"),s=JSON.parse(t),n=s;if(s.env&&typeof s.env=="object"){n=s.env;try{(0,L.writeFileSync)(e,JSON.stringify(n,null,2),"utf-8"),console.log("[SETTINGS] Migrated settings file from nested to flat schema:",e)}catch(i){console.warn("[SETTINGS] Failed to auto-migrate settings file:",e,i instanceof Error?i.message:String(i))}}let o={...this.DEFAULTS};for(let i of Object.keys(this.DEFAULTS))n[i]!==void 0&&(o[i]=n[i]);return this.applyEnvOverrides(o)}catch(t){return console.warn("[SETTINGS] Failed to load settings, using defaults:",e,t instanceof Error?t.message:String(t)),this.applyEnvOverrides(this.getAllDefaults())}}};var F=require("fs"),K=require("path");var C=class r{static instance=null;activeMode=null;modesDir;constructor(){let e=Le(),t=[(0,K.join)(e,"modes"),(0,K.join)(e,"..","plugin","modes")],s=t.find(n=>(0,F.existsSync)(n));this.modesDir=s||t[0]}static getInstance(){return r.instance||(r.instance=new r),r.instance}parseInheritance(e){let t=e.split("--");if(t.length===1)return{hasParent:!1,parentId:"",overrideId:""};if(t.length>2)throw new Error(`Invalid mode inheritance: ${e}. Only one level of inheritance supported (parent--override)`);return{hasParent:!0,parentId:t[0],overrideId:e}}isPlainObject(e){return e!==null&&typeof e=="object"&&!Array.isArray(e)}deepMerge(e,t){let s={...e};for(let n in t){let o=t[n],i=e[n];this.isPlainObject(o)&&this.isPlainObject(i)?s[n]=this.deepMerge(i,o):s[n]=o}return s}loadModeFile(e){let t=(0,K.join)(this.modesDir,`${e}.json`);if(!(0,F.existsSync)(t))throw new Error(`Mode file not found: ${t}`);let s=(0,F.readFileSync)(t,"utf-8");return JSON.parse(s)}loadMode(e){let t=this.parseInheritance(e);if(!t.hasParent)try{let d=this.loadModeFile(e);return this.activeMode=d,u.debug("SYSTEM",`Loaded mode: ${d.name} (${e})`,void 0,{types:d.observation_types.map(p=>p.id),concepts:d.observation_concepts.map(p=>p.id)}),d}catch(d){if(d instanceof Error?u.warn("WORKER",`Mode file not found: ${e}, falling back to 'code'`,{message:d.message}):u.warn("WORKER",`Mode file not found: ${e}, falling back to 'code'`,{error:String(d)}),e==="code")throw new Error("Critical: code.json mode file missing");return this.loadMode("code")}let{parentId:s,overrideId:n}=t,o;try{o=this.loadMode(s)}catch(d){d instanceof Error?u.warn("WORKER",`Parent mode '${s}' not found for ${e}, falling back to 'code'`,{message:d.message}):u.warn("WORKER",`Parent mode '${s}' not found for ${e}, falling back to 'code'`,{error:String(d)}),o=this.loadMode("code")}let i;try{i=this.loadModeFile(n),u.debug("SYSTEM",`Loaded override file: ${n} for parent ${s}`)}catch(d){return d instanceof Error?u.warn("WORKER",`Override file '${n}' not found, using parent mode '${s}' only`,{message:d.message}):u.warn("WORKER",`Override file '${n}' not found, using parent mode '${s}' only`,{error:String(d)}),this.activeMode=o,o}if(!i)return u.warn("SYSTEM",`Invalid override file: ${n}, using parent mode '${s}' only`),this.activeMode=o,o;let a=this.deepMerge(o,i);return this.activeMode=a,u.debug("SYSTEM",`Loaded mode with inheritance: ${a.name} (${e} = ${s} + ${n})`,void 0,{parent:s,override:n,types:a.observation_types.map(d=>d.id),concepts:a.observation_concepts.map(d=>d.id)}),a}getActiveMode(){if(!this.activeMode)throw new Error("No mode loaded. Call loadMode() first.");return this.activeMode}getObservationTypes(){return this.getActiveMode().observation_types}getObservationConcepts(){return this.getActiveMode().observation_concepts}getTypeIcon(e){return this.getObservationTypes().find(s=>s.id===e)?.emoji||"\u{1F4DD}"}getWorkEmoji(e){return this.getObservationTypes().find(s=>s.id===e)?.work_emoji||"\u{1F4DD}"}validateType(e){return this.getObservationTypes().some(t=>t.id===e)}getTypeLabel(e){return this.getObservationTypes().find(s=>s.id===e)?.label||e}};function ue(){let r=w.settings(),e=q.loadFromFile(r),t=C.getInstance().getActiveMode(),s=new Set(t.observation_types.map(o=>o.id)),n=new Set(t.observation_concepts.map(o=>o.id));return{totalObservationCount:parseInt(e.CLAUDE_MEM_CONTEXT_OBSERVATIONS,10),fullObservationCount:parseInt(e.CLAUDE_MEM_CONTEXT_FULL_COUNT,10),sessionCount:parseInt(e.CLAUDE_MEM_CONTEXT_SESSION_COUNT,10),showReadTokens:e.CLAUDE_MEM_CONTEXT_SHOW_READ_TOKENS==="true",showWorkTokens:e.CLAUDE_MEM_CONTEXT_SHOW_WORK_TOKENS==="true",showSavingsAmount:e.CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT==="true",showSavingsPercent:e.CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_PERCENT==="true",observationTypes:s,observationConcepts:n,fullObservationField:e.CLAUDE_MEM_CONTEXT_FULL_FIELD,showLastSummary:e.CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY==="true",showLastMessage:e.CLAUDE_MEM_CONTEXT_SHOW_LAST_MESSAGE==="true"}}var c={reset:"\x1B[0m",bright:"\x1B[1m",dim:"\x1B[2m",cyan:"\x1B[36m",green:"\x1B[32m",yellow:"\x1B[33m",blue:"\x1B[34m",magenta:"\x1B[35m",gray:"\x1B[90m",red:"\x1B[31m"},Pe=4,pe=1;function _e(r){let e=(r.title?.length||0)+(r.subtitle?.length||0)+(r.narrative?.length||0)+JSON.stringify(r.facts||[]).length;return Math.ceil(e/Pe)}function le(r){let e=r.length,t=r.reduce((i,a)=>i+_e(a),0),s=r.reduce((i,a)=>i+(a.discovery_tokens||0),0),n=s-t,o=s>0?Math.round(n/s*100):0;return{totalObservations:e,totalReadTokens:t,totalDiscoveryTokens:s,savings:n,savingsPercent:o}}function Qt(r){return C.getInstance().getWorkEmoji(r)}function $(r,e){let t=_e(r),s=r.discovery_tokens||0,n=Qt(r.type),o=s>0?`${n} ${s.toLocaleString()}`:"-";return{readTokens:t,discoveryTokens:s,discoveryDisplay:o,workEmoji:n}}function J(r){return r.showReadTokens||r.showWorkTokens||r.showSavingsAmount||r.showSavingsPercent}var Fe=x(require("path"),1),Q=require("fs");var zt=["private","claude-mem-plus-context","system_instruction","system-instruction","persisted-output","system-reminder"],or=new RegExp(`<(${zt.join("|")})\\b[^>]*>[\\s\\S]*?</\\1>`,"g"),ke=/<system-reminder>[\s\S]*?<\/system-reminder>/g;var Zt=["task-notification"],ir=new RegExp(`^\\s*<(${Zt.join("|")})\\b[^>]*>(?:(?!<\\1\\b|</\\1\\b)[\\s\\S])*</\\1>\\s*$`),ar=256*1024;function me(r,e,t){let s=Array.from(t.observationTypes),n=s.map(()=>"?").join(","),o=Array.from(t.observationConcepts),i=o.map(()=>"?").join(",");return r.db.prepare(`
    SELECT
      o.id,
      o.memory_session_id,
      COALESCE(s.platform_source, 'claude') as platform_source,
      o.type,
      o.title,
      o.subtitle,
      o.narrative,
      o.facts,
      o.concepts,
      o.files_read,
      o.files_modified,
      o.discovery_tokens,
      o.created_at,
      o.created_at_epoch
    FROM observations o
    LEFT JOIN sdk_sessions s ON o.memory_session_id = s.memory_session_id
    WHERE (o.project = ? OR o.merged_into_project = ?)
      AND type IN (${n})
      AND EXISTS (
        SELECT 1 FROM json_each(o.concepts)
        WHERE value IN (${i})
      )
    ORDER BY o.created_at_epoch DESC
    LIMIT ?
  `).all(e,e,...s,...o,t.totalObservationCount)}function Ee(r,e,t){return r.db.prepare(`
    SELECT
      ss.id,
      ss.memory_session_id,
      COALESCE(s.platform_source, 'claude') as platform_source,
      ss.request,
      ss.investigated,
      ss.learned,
      ss.completed,
      ss.next_steps,
      ss.created_at,
      ss.created_at_epoch
    FROM session_summaries ss
    LEFT JOIN sdk_sessions s ON ss.memory_session_id = s.memory_session_id
    WHERE (ss.project = ? OR ss.merged_into_project = ?)
    ORDER BY ss.created_at_epoch DESC
    LIMIT ?
  `).all(e,e,t.sessionCount+pe)}function $e(r,e,t){let s=Array.from(t.observationTypes),n=s.map(()=>"?").join(","),o=Array.from(t.observationConcepts),i=o.map(()=>"?").join(","),a=e.map(()=>"?").join(",");return r.db.prepare(`
    SELECT
      o.id,
      o.memory_session_id,
      COALESCE(s.platform_source, 'claude') as platform_source,
      o.type,
      o.title,
      o.subtitle,
      o.narrative,
      o.facts,
      o.concepts,
      o.files_read,
      o.files_modified,
      o.discovery_tokens,
      o.created_at,
      o.created_at_epoch,
      o.project
    FROM observations o
    LEFT JOIN sdk_sessions s ON o.memory_session_id = s.memory_session_id
    WHERE (o.project IN (${a})
           OR o.merged_into_project IN (${a}))
      AND type IN (${n})
      AND EXISTS (
        SELECT 1 FROM json_each(o.concepts)
        WHERE value IN (${i})
      )
    ORDER BY o.created_at_epoch DESC
    LIMIT ?
  `).all(...e,...e,...s,...o,t.totalObservationCount)}function je(r,e,t){let s=e.map(()=>"?").join(",");return r.db.prepare(`
    SELECT
      ss.id,
      ss.memory_session_id,
      COALESCE(s.platform_source, 'claude') as platform_source,
      ss.request,
      ss.investigated,
      ss.learned,
      ss.completed,
      ss.next_steps,
      ss.created_at,
      ss.created_at_epoch,
      ss.project
    FROM session_summaries ss
    LEFT JOIN sdk_sessions s ON ss.memory_session_id = s.memory_session_id
    WHERE (ss.project IN (${s})
           OR ss.merged_into_project IN (${s}))
    ORDER BY ss.created_at_epoch DESC
    LIMIT ?
  `).all(...e,...e,t.sessionCount+pe)}function es(r){return r.replace(/\//g,"-")}function ts(r){if(!r.includes('"type":"assistant"'))return null;let e=JSON.parse(r);if(e.type==="assistant"&&e.message?.content&&Array.isArray(e.message.content)){let t="";for(let s of e.message.content)s.type==="text"&&(t+=s.text);if(t=t.replace(ke,"").trim(),t)return t}return null}function ss(r){for(let e=r.length-1;e>=0;e--)try{let t=ts(r[e]);if(t)return t}catch(t){t instanceof Error?u.debug("WORKER","Skipping malformed transcript line",{lineIndex:e},t):u.debug("WORKER","Skipping malformed transcript line",{lineIndex:e,error:String(t)});continue}return""}function rs(r){try{if(!(0,Q.existsSync)(r))return{userMessage:"",assistantMessage:""};let e=(0,Q.readFileSync)(r,"utf-8").trim();if(!e)return{userMessage:"",assistantMessage:""};let t=e.split(`
`).filter(n=>n.trim());return{userMessage:"",assistantMessage:ss(t)}}catch(e){return e instanceof Error?u.failure("WORKER","Failed to extract prior messages from transcript",{transcriptPath:r},e):u.warn("WORKER","Failed to extract prior messages from transcript",{transcriptPath:r,error:String(e)}),{userMessage:"",assistantMessage:""}}}function ge(r,e,t,s){if(!e.showLastMessage||r.length===0)return{userMessage:"",assistantMessage:""};let n=r.find(d=>d.memory_session_id!==t);if(!n)return{userMessage:"",assistantMessage:""};let o=n.memory_session_id,i=es(s),a=Fe.default.join(M,"projects",i,`${o}.jsonl`);return rs(a)}function He(r,e){let t=e[0]?.id;return r.map((s,n)=>{let o=n===0?null:e[n+1];return{...s,displayEpoch:o?o.created_at_epoch:s.created_at_epoch,displayTime:o?o.created_at:s.created_at,shouldShowLink:s.id!==t}})}function Te(r,e){let t=[...r.map(s=>({type:"observation",data:s})),...e.map(s=>({type:"summary",data:s}))];return t.sort((s,n)=>{let o=s.type==="observation"?s.data.created_at_epoch:s.data.displayEpoch,i=n.type==="observation"?n.data.created_at_epoch:n.data.displayEpoch;return o-i}),t}function Ge(r,e){return new Set(r.slice(0,e).map(t=>t.id))}function Xe(){let r=new Date,e=r.toLocaleDateString("en-CA"),t=r.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:!0}).toLowerCase().replace(" ",""),s=r.toLocaleTimeString("en-US",{timeZoneName:"short"}).split(" ").pop();return`${e} ${t} ${s}`}function Be(r){return[`# [${r}] recent context, ${Xe()}`,""]}function We(){return[`Legend: \u{1F3AF}session ${C.getInstance().getActiveMode().observation_types.map(t=>`${t.emoji}${t.id}`).join(" ")}`,"Format: ID TIME TYPE TITLE","Fetch details: get_observations([IDs]) | Search: mem-search skill",""]}function Ve(){return[]}function Ye(){return[]}function qe(r,e){let t=[],s=[`${r.totalObservations} obs (${r.totalReadTokens.toLocaleString()}t read)`,`${r.totalDiscoveryTokens.toLocaleString()}t work`];return r.totalDiscoveryTokens>0&&(e.showSavingsAmount||e.showSavingsPercent)&&(e.showSavingsPercent?s.push(`${r.savingsPercent}% savings`):e.showSavingsAmount&&s.push(`${r.savings.toLocaleString()}t saved`)),t.push(`Stats: ${s.join(" | ")}`),t.push(""),t}function Ke(r){return[`### ${r}`]}function Je(r){return r.toLowerCase().replace(" am","a").replace(" pm","p")}function Qe(r,e,t){let s=r.title||"Untitled",n=C.getInstance().getTypeIcon(r.type),o=e?Je(e):'"';return`${r.id} ${o} ${n} ${s}`}function ze(r,e,t,s){let n=[],o=r.title||"Untitled",i=C.getInstance().getTypeIcon(r.type),a=e?Je(e):'"',{readTokens:d,discoveryDisplay:p}=$(r,s);n.push(`**${r.id}** ${a} ${i} **${o}**`),t&&n.push(t);let _=[];return s.showReadTokens&&_.push(`~${d}t`),s.showWorkTokens&&_.push(p),_.length>0&&n.push(_.join(" ")),n.push(""),n}function Ze(r,e){return[`S${r.id} ${r.request||"Session started"} (${e})`]}function j(r,e){return e?[`**${r}**: ${e}`,""]:[]}function et(r){return r.assistantMessage?["","---","","**Previously**","",`A: ${r.assistantMessage}`,""]:[]}function tt(r,e){return["",`Access ${Math.round(r/1e3)}k tokens of past work via get_observations([IDs]) or mem-search skill.`]}function st(r){return`# [${r}] recent context, ${Xe()}

No previous sessions found.`}var rt={zh:{recentContext:"\u6700\u8FD1\u4E0A\u4E0B\u6587",legend:"\u56FE\u4F8B",legendSession:"\u4F1A\u8BDD\u8BF7\u6C42",columnKey:"\u5217\u8BF4\u660E",colReadDesc:"\u9605\u8BFB\u8FD9\u6761 observation \u7684\u8BCD\u5143\u6570(\u73B0\u5728\u5B66\u7684\u6210\u672C)",colWorkDesc:"\u4EA7\u51FA\u8FD9\u6761\u8BB0\u5F55\u82B1\u7684\u5DE5\u4F5C\u8BCD\u5143(\u8C03\u7814 / \u6784\u5EFA / \u51B3\u7B56)",contextIndex:"\u4E0A\u4E0B\u6587\u7D22\u5F15: \u8FD9\u4EFD\u8BED\u4E49\u7D22\u5F15(\u6807\u9898 / \u7C7B\u578B / \u6587\u4EF6 / \u8BCD\u5143)\u901A\u5E38\u8DB3\u4EE5\u7406\u89E3\u8FC7\u5F80\u5DE5\u4F5C\u3002",whenNeed:"\u5F53\u4F60\u9700\u8981\u5B9E\u73B0\u7EC6\u8282\u3001\u539F\u56E0\u6216\u8C03\u8BD5\u4E0A\u4E0B\u6587\u65F6:",fetchById:"\u6309 ID \u53D6: get_observations([IDs]) \u62C9\u53D6\u672C\u7D22\u5F15\u53EF\u89C1\u7684 observation",searchHistory:"\u641C\u5386\u53F2: \u7528 mem-search skill \u67E5\u8FC7\u5F80\u51B3\u7B56\u3001bug \u4E0E\u6DF1\u5EA6\u8C03\u7814",trustIndex:"\u4FE1\u4EFB\u672C\u7D22\u5F15,\u4E0D\u5FC5\u4E3A\u67E5\u8FC7\u5F80\u51B3\u7B56\u548C\u5B66\u5230\u7684\u5185\u5BB9\u91CD\u65B0\u8BFB\u4EE3\u7801",contextEconomics:"\u4E0A\u4E0B\u6587\u7ECF\u6D4E",loading:(r,e)=>`\u8F7D\u5165: ${r} \u6761 observation (${e} \u8BCD\u5143\u5F85\u8BFB)`,workInvest:r=>`\u5DE5\u4F5C\u6295\u5165: ${r} \u8BCD\u5143\u7528\u4E8E\u8C03\u7814\u3001\u6784\u5EFA\u4E0E\u51B3\u7B56`,yourSavings:"\u4F60\u8282\u7701",tokensSavings:(r,e)=>`${r} \u8BCD\u5143(\u590D\u7528\u51CF\u5C11 ${e}%)`,tokensOnly:r=>`${r} \u8BCD\u5143`,pctOnly:r=>`\u590D\u7528\u51CF\u5C11 ${r}%`,untitled:"\u672A\u547D\u540D",sessionStarted:"\u4F1A\u8BDD\u5F00\u59CB",previously:"\u4E4B\u524D",footerAccess:(r,e)=>`\u7528 ${e}t \u8BCD\u5143\u8BBF\u95EE\u8FC7\u5F80 ${r}k \u8BCD\u5143\u7684\u8C03\u7814\u4E0E\u51B3\u7B56\u3002\u7528 claude-mem-plus skill \u6309 ID \u53D6\u8BB0\u5FC6\u3002`,emptyState:"\u672C\u9879\u76EE\u6682\u65E0\u8FC7\u5F80\u4F1A\u8BDD\u3002"},en:{recentContext:"recent context",legend:"Legend",legendSession:"session-request",columnKey:"Column Key",colReadDesc:"Tokens to read this observation (cost to learn it now)",colWorkDesc:"Tokens spent on work that produced this record (research, building, deciding)",contextIndex:"Context Index: This semantic index (titles, types, files, tokens) is usually sufficient to understand past work.",whenNeed:"When you need implementation details, rationale, or debugging context:",fetchById:"Fetch by ID: get_observations([IDs]) for observations visible in this index",searchHistory:"Search history: Use the mem-search skill for past decisions, bugs, and deeper research",trustIndex:"Trust this index over re-reading code for past decisions and learnings",contextEconomics:"Context Economics",loading:(r,e)=>`Loading: ${r} observations (${e} tokens to read)`,workInvest:r=>`Work investment: ${r} tokens spent on research, building, and decisions`,yourSavings:"Your savings",tokensSavings:(r,e)=>`${r} tokens (${e}% reduction from reuse)`,tokensOnly:r=>`${r} tokens`,pctOnly:r=>`${r}% reduction from reuse`,untitled:"Untitled",sessionStarted:"Session started",previously:"Previously",footerAccess:(r,e)=>`Access ${r}k tokens of past research & decisions for just ${e}t. Use the claude-mem-plus skill to access memories by ID.`,emptyState:"No previous sessions found for this project yet."}},ns="zh";function O(){return rt[ns]||rt.en}function nt(){let r=new Date,e=r.toLocaleDateString("en-CA"),t=r.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:!0}).toLowerCase().replace(" ",""),s=r.toLocaleTimeString("en-US",{timeZoneName:"short"}).split(" ").pop();return`${e} ${t} ${s}`}function ot(r){return["",`${c.bright}${c.cyan}[${r}] ${O().recentContext}, ${nt()}${c.reset}`,`${c.gray}${"\u2500".repeat(60)}${c.reset}`,""]}function it(){let e=C.getInstance().getActiveMode().observation_types.map(t=>`${t.emoji} ${t.id}`).join(" | ");return[`${c.dim}${O().legend}: ${O().legendSession} | ${e}${c.reset}`,""]}function at(){return[`${c.bright}${O().columnKey}${c.reset}`,`${c.dim}  Read: ${O().colReadDesc}${c.reset}`,`${c.dim}  Work: ${O().colWorkDesc}${c.reset}`,""]}function dt(){return[`${c.dim}${O().contextIndex}${c.reset}`,"",`${c.dim}${O().whenNeed}${c.reset}`,`${c.dim}  - ${O().fetchById}${c.reset}`,`${c.dim}  - ${O().searchHistory}${c.reset}`,`${c.dim}  - ${O().trustIndex}${c.reset}`,""]}function ct(r,e){let t=[],s=O();if(t.push(`${c.bright}${c.cyan}${s.contextEconomics}${c.reset}`),t.push(`${c.dim}  ${s.loading(r.totalObservations,r.totalReadTokens.toLocaleString())}${c.reset}`),t.push(`${c.dim}  ${s.workInvest(r.totalDiscoveryTokens.toLocaleString())}${c.reset}`),r.totalDiscoveryTokens>0&&(e.showSavingsAmount||e.showSavingsPercent)){let n=`  ${s.yourSavings}: `;e.showSavingsAmount&&e.showSavingsPercent?n+=s.tokensSavings(r.savings.toLocaleString(),r.savingsPercent):e.showSavingsAmount?n+=s.tokensOnly(r.savings.toLocaleString()):n+=s.pctOnly(r.savingsPercent),t.push(`${c.green}${n}${c.reset}`)}return t.push(""),t}function ut(r){return[`${c.bright}${c.cyan}${r}${c.reset}`,""]}function pt(r){return[`${c.dim}${r}${c.reset}`]}function _t(r,e,t,s){let n=r.title||O().untitled,o=C.getInstance().getTypeIcon(r.type),{readTokens:i,discoveryTokens:a,workEmoji:d}=$(r,s),p=t?`${c.dim}${e}${c.reset}`:" ".repeat(e.length),_=s.showReadTokens&&i>0?`${c.dim}(~${i}t)${c.reset}`:"",m=s.showWorkTokens&&a>0?`${c.dim}(${d} ${a.toLocaleString()}t)${c.reset}`:"";return`  ${c.dim}#${r.id}${c.reset}  ${p}  ${o}  ${n} ${_} ${m}`}function lt(r,e,t,s,n){let o=[],i=r.title||O().untitled,a=C.getInstance().getTypeIcon(r.type),{readTokens:d,discoveryTokens:p,workEmoji:_}=$(r,n),m=t?`${c.dim}${e}${c.reset}`:" ".repeat(e.length),E=n.showReadTokens&&d>0?`${c.dim}(~${d}t)${c.reset}`:"",g=n.showWorkTokens&&p>0?`${c.dim}(${_} ${p.toLocaleString()}t)${c.reset}`:"";return o.push(`  ${c.dim}#${r.id}${c.reset}  ${m}  ${a}  ${c.bright}${i}${c.reset}`),s&&o.push(`    ${c.dim}${s}${c.reset}`),(E||g)&&o.push(`    ${E} ${g}`),o.push(""),o}function mt(r,e){let t=`${r.request||O().sessionStarted} (${e})`;return[`${c.yellow}#S${r.id}${c.reset} ${t}`,""]}function H(r,e,t){return e?[`${t}${r}:${c.reset} ${e}`,""]:[]}function Et(r){return r.assistantMessage?["","---","",`${c.bright}${c.magenta}${O().previously}${c.reset}`,"",`${c.dim}A: ${r.assistantMessage}${c.reset}`,""]:[]}function gt(r,e){let t=Math.round(r/1e3);return["",`${c.dim}${O().footerAccess(t,e.toLocaleString())}${c.reset}`]}function Tt(r){return`
${c.bright}${c.cyan}[${r}] ${O().recentContext}, ${nt()}${c.reset}
${c.gray}${"\u2500".repeat(60)}${c.reset}

${c.dim}${O().emptyState}${c.reset}
`}function ht(r,e,t,s){let n=[];return s?n.push(...ot(r)):n.push(...Be(r)),s?n.push(...it()):n.push(...We()),s?n.push(...at()):n.push(...Ve()),s?n.push(...dt()):n.push(...Ye()),J(t)&&(s?n.push(...ct(e,t)):n.push(...qe(e,t))),n}var he=x(require("path"),1);function ee(r){if(!r)return[];try{let e=JSON.parse(r);return Array.isArray(e)?e:[]}catch(e){return u.debug("PARSER","Failed to parse JSON array, using empty fallback",{preview:r?.substring(0,50)},e instanceof Error?e:new Error(String(e))),[]}}function fe(r){return new Date(r).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",hour12:!0})}function Se(r){return new Date(r).toLocaleString("en-US",{hour:"numeric",minute:"2-digit",hour12:!0})}function St(r){return new Date(r).toLocaleString("en-US",{month:"short",day:"numeric",year:"numeric"})}function ft(r,e){return he.default.isAbsolute(r)?he.default.relative(e,r):r}function bt(r,e,t){let s=ee(r);if(s.length>0)return ft(s[0],e);if(t){let n=ee(t);if(n.length>0)return ft(n[0],e)}return"General"}function os(r){let e=new Map;for(let s of r){let n=s.type==="observation"?s.data.created_at:s.data.displayTime,o=St(n);e.has(o)||e.set(o,[]),e.get(o).push(s)}let t=Array.from(e.entries()).sort((s,n)=>{let o=new Date(s[0]).getTime(),i=new Date(n[0]).getTime();return o-i});return new Map(t)}function Rt(r,e){return e.fullObservationField==="narrative"?r.narrative:r.facts?ee(r.facts).join(`
`):null}function is(r,e,t,s){let n=[];n.push(...Ke(r));let o="";for(let i of e)if(i.type==="summary"){let a=i.data,d=fe(a.displayTime);n.push(...Ze(a,d))}else{let a=i.data,d=Se(a.created_at),_=d!==o?d:"";if(o=d,t.has(a.id)){let E=Rt(a,s);n.push(...ze(a,_,E,s))}else n.push(Qe(a,_,s))}return n}function as(r,e,t,s,n){let o=[];o.push(...ut(r));let i=null,a="";for(let d of e)if(d.type==="summary"){i=null,a="";let p=d.data,_=fe(p.displayTime);o.push(...mt(p,_))}else{let p=d.data,_=bt(p.files_modified,n,p.files_read),m=Se(p.created_at),E=m!==a;a=m;let g=t.has(p.id);if(_!==i&&(o.push(...pt(_)),i=_),g){let h=Rt(p,s);o.push(...lt(p,m,E,h,s))}else o.push(_t(p,m,E,s))}return o.push(""),o}function ds(r,e,t,s,n,o){return o?as(r,e,t,s,n):is(r,e,t,s)}function Ot(r,e,t,s,n){let o=[],i=os(r);for(let[a,d]of i)o.push(...ds(a,d,e,t,s,n));return o}function Nt(r,e,t){return!(!r.showLastSummary||!e||!!!(e.investigated||e.learned||e.completed||e.next_steps)||t&&e.created_at_epoch<=t.created_at_epoch)}function At(r,e){let t=[];return e?(t.push(...H("Investigated",r.investigated,c.blue)),t.push(...H("Learned",r.learned,c.yellow)),t.push(...H("Completed",r.completed,c.green)),t.push(...H("Next Steps",r.next_steps,c.magenta))):(t.push(...j("Investigated",r.investigated)),t.push(...j("Learned",r.learned)),t.push(...j("Completed",r.completed)),t.push(...j("Next Steps",r.next_steps))),t}function It(r,e){return e?Et(r):et(r)}function Ct(r,e,t){return!J(e)||r.totalDiscoveryTokens<=0||r.savings<=0?[]:t?gt(r.totalDiscoveryTokens,r.totalReadTokens):tt(r.totalDiscoveryTokens,r.totalReadTokens)}var cs=Lt.default.join((0,vt.homedir)(),".claude","plugins","marketplaces","bjarne56","plugin",".install-version");function us(){try{return new Y}catch(r){if(r instanceof Error&&r.code==="ERR_DLOPEN_FAILED"){try{(0,yt.unlinkSync)(cs)}catch(e){e instanceof Error?u.debug("WORKER","Marker file cleanup failed (may not exist)",{},e):u.debug("WORKER","Marker file cleanup failed (may not exist)",{error:String(e)})}return u.error("WORKER","Native module rebuild needed - restart Claude Code to auto-fix"),null}throw r}}function ps(r,e){return e?Tt(r):st(r)}function _s(r,e,t,s,n,o,i){let a=[],d=le(e);a.push(...ht(r,d,s,i));let p=t.slice(0,s.sessionCount),_=He(p,t),m=Te(e,_),E=Ge(e,s.fullObservationCount);a.push(...Ot(m,E,s,n,i));let g=t[0],h=e[0];Nt(s,g,h)&&a.push(...At(g,i));let f=ge(e,s,o,n);return a.push(...It(f,i)),a.push(...Ct(d,s,i)),a.join(`
`).trimEnd()}async function be(r,e=!1){let t=ue(),s=r?.cwd??process.cwd(),n=ie(s),o=r?.projects?.length?r.projects:n.allProjects,i=o[o.length-1]??n.primary;r?.full&&(t.totalObservationCount=999999,t.sessionCount=999999);let a=us();if(!a)return"";try{let d=o.length>1?$e(a,o,t):me(a,i,t),p=o.length>1?je(a,o,t):Ee(a,i,t);return d.length===0&&p.length===0?ps(i,e):_s(i,d,p,t,s,r?.session_id,e)}finally{a.close()}}0&&(module.exports={generateContext});
