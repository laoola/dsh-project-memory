window.__ModuleLoader__.load({id:`dsh-project-memory`,factory:e=>{var t={exports:{}},n=t.exports;Object.defineProperty(n,Symbol.toStringTag,{value:`Module`}),Object.defineProperty(n,Symbol.toStringTag,{value:`Module`});let r=e("react"),i=e("react-dom/client"),a=e("react/jsx-runtime");var o={meta:{title:`项目记忆`,description:`本机跨对话项目记忆：自动注入 MEMORY.md 索引 + memory_read/write/search 工具，与 Claude Code 记忆罗盘共库。无云端、无遥测。`},client:{panel:{entry:`知识库`,title:`知识库`,readonly:`只读视图`},sections:{global:`全局记忆`,projects:`项目记忆`,sources:`本地知识源`,knowledge:`知识域 · 预留`},knowledge:{reserved:`预留数据域：knowledge 分区将在 M3 落地`},cards:{heading:`知识入口`,globalTitle:`全局记忆`,globalDesc:`跨项目共享的全局记忆与索引`},fold:{more:`展开 其余 {count} 个项目`,less:`收起折叠的项目`},empty:{listTitle:`这里还是空的`,list:`该分区暂无 Markdown 文件。`,searchTitle:`没有找到`,search:`没有找到「{query}」— 换个更短的关键词试试。`},search:{placeholder:`全文检索：跨分区搜主题文件正文，返回命中行…`,title:`搜索结果`,stat:`共 {files} 个文件命中 {lines} 行（host 端检索，跨分区）`},state:{loading:`加载中…`,error:`加载失败`},doc:{back:`返回`,close:`关闭`},meta:{count:`{projects} 个项目记忆 · {sources} 个知识源`}}},s={meta:{title:`Project Memory`,description:`Local per-project cross-conversation memory, sharing the Claude Code memory-compass store (MEMORY.md index + topic files). No cloud, no telemetry.`},client:{panel:{entry:`Knowledge Base`,title:`Knowledge Base`,readonly:`Read-only view`},sections:{global:`Global memory`,projects:`Project memory`,sources:`Local knowledge sources`,knowledge:`Knowledge · reserved`},knowledge:{reserved:`Reserved data domain: the knowledge section ships in M3`},cards:{heading:`Knowledge entries`,globalTitle:`Global memory`,globalDesc:`Cross-project global memory and index`},fold:{more:`Show {count} more projects`,less:`Collapse folded projects`},empty:{listTitle:`Nothing here yet`,list:`No Markdown files in this section.`,searchTitle:`No results`,search:`Nothing found for "{query}" — try a shorter keyword.`},search:{placeholder:`Full-text search across sections, returns matching lines…`,title:`Search results`,stat:`{files} file(s) matched {lines} line(s) (host-side search, cross-section)`},state:{loading:`Loading…`,error:`Failed to load`},doc:{back:`Back`,close:`Close`},meta:{count:`{projects} project memories · {sources} knowledge sources`}}};function c(e,t=``,n={}){if(typeof e!=`object`||!e)return n;for(let[r,i]of Object.entries(e)){let e=t?`${t}.${r}`:r;typeof i==`string`?n[e]=i:c(i,e,n)}return n}let l={zh:c(o),en:c(s)};function u(){try{return(document.documentElement?.getAttribute(`lang`)||navigator.language||`en`).toLowerCase().startsWith(`zh`)?`zh`:`en`}catch{return`en`}}let d=u(),f=new Set;function p(e){let t=String(e).toLowerCase().startsWith(`zh`)?`zh`:`en`;if(t!==d){d=t;for(let e of f)e()}}function m(e){let t=e,n,r=()=>{try{let e=t?.getSnapshot?.()?.active;typeof e==`string`&&p(e)}catch{}};if(r(),typeof t?.subscribe==`function`)try{let e=t.subscribe(r);typeof e==`function`&&(n=e)}catch{}return()=>{n?.(),n=void 0}}function h(e,t){let n=(l[d]??{})[e]??l.en[e]??e;if(t)for(let[e,r]of Object.entries(t))n=n.split(`{${e}}`).join(String(r));return n}let g=e=>(f.add(e),()=>f.delete(e)),_=()=>d;function v(){return(0,r.useSyncExternalStore)(g,_,_),h}var y=class extends Error{code;constructor(e,t){super(`${e}: ${t}`),this.name=`ApiError`,this.code=e}};async function b(e,t){let n;try{n=await e}catch(e){throw new y(`network`,`${t}: 网络请求失败（${e instanceof Error?e.message:String(e)}）`)}let r;try{r=await n.text()}catch{throw new y(`network`,`${t}: 响应体读取失败（HTTP ${n.status}）`)}if(r.trim().length===0)throw new y(`empty_body`,`${t}: 空响应（HTTP ${n.status}）`);let i;try{i=JSON.parse(r)}catch{throw new y(`bad_json`,`${t}: 非 JSON 响应（HTTP ${n.status}）`)}if(typeof i!=`object`||!i||!(`ok`in i))throw new y(`bad_envelope`,`${t}: 非法响应结构`);let a=i;if(!a.ok)throw typeof a.error?.code!=`string`||typeof a.error?.message!=`string`?new y(`bad_envelope`,`${t}: 非法错误响应`):new y(a.error.code,a.error.message);if(!(`value`in a))throw new y(`bad_envelope`,`${t}: 响应缺 value`);return a.value}async function x(e){return b(fetch(`/dsh-project-memory${e}`,{signal:AbortSignal.timeout(1e4)}),e)}let S={overview:()=>x(`/api/overview`),list:e=>x(`/api/list?section=${encodeURIComponent(e)}`),file:e=>x(`/api/file?path=${encodeURIComponent(e)}`),search:e=>x(`/api/search?q=${encodeURIComponent(e)}`)};function C(e){let t=e.trim();return/^https?:\/\//i.test(t)||t.startsWith(`#`)?t:null}function w(e,t=``){let n=[],r=/`([^`]+)`|\*\*([^*]+)\*\*|\*([^*\s][^*]*?)\*|\[([^\]]+)\]\(([^)\s]+)\)/g,i=0,o,s=0;for(;(o=r.exec(e))!==null;){o.index>i&&n.push(e.slice(i,o.index));let c=`${t}i${s++}`;if(o[1]!==void 0)n.push((0,a.jsx)(`code`,{children:o[1]},c));else if(o[2]!==void 0)n.push((0,a.jsx)(`strong`,{children:w(o[2],c)},c));else if(o[3]!==void 0)n.push((0,a.jsx)(`em`,{children:w(o[3],c)},c));else if(o[4]!==void 0&&o[5]!==void 0){let e=C(o[5]);n.push(e?(0,a.jsx)(`a`,{href:e,target:`_blank`,rel:`noreferrer noopener`,children:o[4]},c):(0,a.jsx)(`span`,{children:o[4]},c))}i=r.lastIndex}return i<e.length&&n.push(e.slice(i)),n}function T(e,t,n=``){let r=t.trim().toLowerCase();if(!r)return[e];let i=[],o=e.toLowerCase(),s=0,c=0;for(;s<e.length;){let t=o.indexOf(r,s);if(t<0){i.push(e.slice(s));break}t>s&&i.push(e.slice(s,t)),i.push((0,a.jsx)(`mark`,{className:`dsh-pm-mark`,children:e.slice(t,t+r.length)},`${n}m${c++}`)),s=t+r.length}return i}function E(e){let t=e.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/,``).split(/\r?\n/),n=[],r,i=!1,a=``,o=[];for(let e of t){if(i){/^\s*```/.test(e)?(n.push({kind:`code`,lines:o,lang:a}),i=!1,o=[],r=void 0):o.push(e);continue}if(/^\s*```/.test(e)){r=void 0,i=!0,a=e.replace(/^\s*```/,``).trim();continue}if(/^\s*$/.test(e)){r=void 0;continue}let t=/^(#{1,3})\s+(.*)$/.exec(e);if(t){let e=t[1].length,i=e===1?`h1`:e===2?`h2`:`h3`;n.push({kind:i,lines:[t[2]]}),r=void 0;continue}if(/^\s*(---+|\*\*\*+)\s*$/.test(e)){n.push({kind:`hr`,lines:[]}),r=void 0;continue}let s=/^\s*[-*+]\s+(.*)$/.exec(e),c=/^\s*\d+[.)]\s+(.*)$/.exec(e);if(s||c){let e=s?`ul`:`ol`;r?.kind!==e&&(r={kind:e,lines:[]},n.push(r)),r.lines.push((s??c)[1]);continue}if(/^\s*>\s?/.test(e)){r?.kind!==`quote`&&(r={kind:`quote`,lines:[]},n.push(r)),r.lines.push(e.replace(/^\s*>\s?/,``));continue}r?.kind!==`p`&&(r={kind:`p`,lines:[]},n.push(r)),r.lines.push(e)}return i&&o.length&&n.push({kind:`code`,lines:o,lang:a}),n}function D({text:e}){return(0,a.jsx)(`div`,{className:`dsh-pm-article`,children:E(e).map((e,t)=>{let n=`b${t}`;switch(e.kind){case`h1`:return(0,a.jsx)(`h1`,{children:w(e.lines[0],n)},n);case`h2`:return(0,a.jsx)(`h2`,{children:w(e.lines[0],n)},n);case`h3`:return(0,a.jsx)(`h3`,{children:w(e.lines[0],n)},n);case`hr`:return(0,a.jsx)(`hr`,{},n);case`code`:return(0,a.jsx)(`pre`,{children:(0,a.jsx)(`code`,{children:e.lines.join(`
`)})},n);case`ul`:return(0,a.jsx)(`ul`,{children:e.lines.map((e,t)=>(0,a.jsx)(`li`,{children:w(e,`${n}-${t}`)},`${n}-${t}`))},n);case`ol`:return(0,a.jsx)(`ol`,{children:e.lines.map((e,t)=>(0,a.jsx)(`li`,{children:w(e,`${n}-${t}`)},`${n}-${t}`))},n);case`quote`:return(0,a.jsx)(`blockquote`,{children:e.lines.map((e,t)=>(0,a.jsx)(`p`,{children:w(e,`${n}-${t}`)},`${n}-${t}`))},n);default:return(0,a.jsx)(`p`,{children:w(e.lines.join(` `),n)},n)}})})}function O(e,t){if(e.length<=t)return e;let n=Math.max(6,Math.floor((t-1)*.45)),r=Math.max(4,t-n-1);return`${e.slice(0,n)}…${e.slice(-r)}`}function k(e){let t=new Map,n=new Map;for(let r of e){if(t.set(r.id,r.name??r.dir),!r.name||!r.displayPath)continue;let e=n.get(r.name);e?e.push(r):n.set(r.name,[r])}for(let[e,r]of n){if(r.length<2)continue;let n=r.map(()=>e);for(let t=1;t<=12&&(n=r.map(n=>{let r=(n.displayPath??``).split(/[\\/]/).filter(Boolean);return[...r.slice(Math.max(0,r.length-1-t),r.length-1).reverse(),e].join(`\\`)}),new Set(n).size!==r.length);t+=1);r.forEach((r,i)=>t.set(r.id,n[i]??e))}return t}function A(e,t){let[n,i]=(0,r.useState)({loading:!0}),a=(0,r.useRef)(e);return a.current=e,(0,r.useEffect)(()=>{let e=!0;return i({loading:!0}),a.current().then(t=>{e&&i({data:t,loading:!1})},t=>{e&&i({error:t instanceof Error?t:Error(String(t)),loading:!1})}),()=>{e=!1}},t),n}function j(e){if(!e)return``;try{return new Date(e).toLocaleDateString()}catch{return``}}function M({size:e=14}){return(0,a.jsxs)(`svg`,{width:e,height:e,viewBox:`0 0 16 16`,fill:`none`,"aria-hidden":`true`,children:[(0,a.jsx)(`path`,{d:`M4 1.5h5.2L13 5.3V14a.5.5 0 0 1-.5.5h-8A.5.5 0 0 1 4 14V1.5Z`,stroke:`currentColor`,strokeLinejoin:`round`}),(0,a.jsx)(`path`,{d:`M9 1.8V5.5h3.6`,stroke:`currentColor`,strokeLinejoin:`round`}),(0,a.jsx)(`path`,{d:`M6 8.5h4M6 11h4`,stroke:`currentColor`,strokeLinecap:`round`})]})}function N({size:e=15}){return(0,a.jsxs)(`svg`,{width:e,height:e,viewBox:`0 0 16 16`,fill:`none`,"aria-hidden":`true`,children:[(0,a.jsx)(`path`,{d:`M2 2.5h2.6v11H2zM6 2.5h2.6v11H6z`,stroke:`currentColor`,strokeLinejoin:`round`}),(0,a.jsx)(`path`,{d:`m10.2 3.3 2.5-.7 2 10.7-2.5.7z`,stroke:`currentColor`,strokeLinejoin:`round`})]})}function P(e,t,n){return e===`global`?n(`client.sections.global`):e.startsWith(`p:`)?t?.projects.find(t=>t.id===e)?.name??e.slice(2):t?.sources.find(t=>t.id===e.slice(2))?.label??e.slice(2)}function F({sectionId:e,onOpenDoc:t,t:n}){let r=A(()=>S.list(e),[e]);if(r.loading)return(0,a.jsx)(`div`,{className:`dsh-pm-loading`,children:n(`client.state.loading`)});if(r.error)return(0,a.jsx)(`div`,{className:`dsh-pm-error`,children:`${n(`client.state.error`)}：${r.error.message}`});let i=r.data?.files??[];return i.length?(0,a.jsxs)(`div`,{children:[(0,a.jsxs)(`div`,{className:`dsh-pm-group-h`,children:[r.data?.label??e,` · `,i.length]}),i.map(e=>(0,a.jsxs)(`button`,{type:`button`,className:`dsh-pm-row`,onClick:()=>t(e),children:[(0,a.jsx)(`span`,{className:`dsh-pm-row-icon`,children:(0,a.jsx)(M,{})}),(0,a.jsxs)(`span`,{className:`dsh-pm-row-main`,children:[(0,a.jsx)(`span`,{className:`dsh-pm-row-title`,children:e.title}),(0,a.jsx)(`span`,{className:`dsh-pm-row-summary`,children:e.summary||e.path})]}),(0,a.jsx)(`span`,{className:`dsh-pm-row-time`,children:j(e.mtimeMs)})]},e.path))]}):(0,a.jsxs)(`div`,{className:`dsh-pm-empty`,children:[(0,a.jsx)(`div`,{className:`dsh-pm-empty-title`,children:n(`client.empty.listTitle`)}),n(`client.empty.list`)]})}function I({q:e,overview:t,onOpenDoc:n,t:r}){let i=A(()=>S.search(e),[e]);if(i.loading)return(0,a.jsx)(`div`,{className:`dsh-pm-loading`,children:r(`client.state.loading`)});if(i.error)return(0,a.jsx)(`div`,{className:`dsh-pm-error`,children:`${r(`client.state.error`)}：${i.error.message}`});let o=i.data;return!o||o.groups.length===0?(0,a.jsxs)(`div`,{className:`dsh-pm-empty`,children:[(0,a.jsx)(`div`,{className:`dsh-pm-empty-title`,children:r(`client.empty.searchTitle`)}),r(`client.empty.search`,{query:e})]}):(0,a.jsxs)(`div`,{children:[(0,a.jsx)(`div`,{className:`dsh-pm-sr-stat`,children:r(`client.search.stat`,{files:o.fileCount,lines:o.lineCount})}),o.groups.map(i=>(0,a.jsxs)(`button`,{type:`button`,className:`dsh-pm-sr-row`,onClick:()=>n(i.path,i.name,P(i.sectionId,t,r)),children:[(0,a.jsxs)(`span`,{className:`dsh-pm-sr-path`,children:[(0,a.jsx)(`span`,{className:`dsh-pm-pill`,children:P(i.sectionId,t,r)}),(0,a.jsx)(`span`,{className:`dsh-pm-sr-name`,children:i.name}),(0,a.jsx)(`span`,{className:`dsh-pm-sr-file`,title:i.path,children:O(i.path,52)})]}),i.lines.map(t=>(0,a.jsxs)(`span`,{className:`dsh-pm-sr-line`,children:[(0,a.jsx)(`span`,{className:`dsh-pm-no`,children:t.no}),T(t.text,e,`l${t.no}`)]},t.no))]},i.path))]})}function L({onClose:e}){let t=v(),[n,i]=(0,r.useState)({kind:`cards`}),[,o]=(0,r.useState)([]),[s,c]=(0,r.useState)(``),[l,u]=(0,r.useState)(!0),d=A(()=>S.overview(),[]).data;(0,r.useEffect)(()=>{let e=s.trim(),t=setTimeout(()=>{i(e?{kind:`search`,q:e}:e=>e.kind===`search`?{kind:`cards`}:e)},250);return()=>clearTimeout(t)},[s]);let f=e=>{o(e=>[...e,n]),i(e)},p=()=>{o(e=>e.length?(i(e[e.length-1]),e.slice(0,-1)):e)},m=()=>{o([]),i({kind:`cards`}),c(``)},h=[...d?.projects??[]].sort((e,t)=>(e.fileCount===0)-+(t.fileCount===0)||t.mtimeMs-e.mtimeMs),g=k(h),_=h.slice(0,3),y=l?[]:h.slice(3),b=n.kind===`doc`?n.path:``,x=A(()=>b?S.file(b):Promise.reject(Error(`inactive`)),[b]),C;C=n.kind===`cards`?(0,a.jsxs)(`div`,{children:[(0,a.jsx)(`div`,{className:`dsh-pm-group-h`,children:t(`client.cards.heading`)}),(0,a.jsxs)(`div`,{className:`dsh-pm-cards`,children:[d?.global.exists&&(0,a.jsxs)(`button`,{type:`button`,className:`dsh-pm-card`,onClick:()=>f({kind:`section`,sectionId:`global`,label:t(`client.sections.global`)}),children:[(0,a.jsxs)(`span`,{className:`dsh-pm-card-head`,children:[(0,a.jsx)(N,{}),` `,t(`client.cards.globalTitle`),` `,(0,a.jsx)(`span`,{className:`dsh-pm-rail-badge`,children:d.global.fileCount})]}),(0,a.jsx)(`span`,{className:`dsh-pm-card-desc`,children:t(`client.cards.globalDesc`)}),(0,a.jsx)(`span`,{className:`dsh-pm-card-path`,title:d.global.path,children:O(d.global.displayPath??d.global.path,46)})]},`global`),(d?.sources??[]).map(e=>(0,a.jsxs)(`button`,{type:`button`,className:`dsh-pm-card`,onClick:()=>f({kind:`section`,sectionId:`s:${e.id}`,label:e.label}),children:[(0,a.jsxs)(`span`,{className:`dsh-pm-card-head`,children:[(0,a.jsx)(N,{}),` `,e.label,` `,(0,a.jsx)(`span`,{className:`dsh-pm-rail-badge`,children:e.fileCount})]}),(0,a.jsx)(`span`,{className:`dsh-pm-card-desc`,children:e.description}),(0,a.jsx)(`span`,{className:`dsh-pm-card-path`,title:e.root,children:O(e.root,46)})]},e.id))]})]}):n.kind===`section`?(0,a.jsx)(F,{sectionId:n.sectionId,onOpenDoc:e=>f({kind:`doc`,path:e.path,name:e.name,label:e.title}),t}):n.kind===`doc`?x.loading?(0,a.jsx)(`div`,{className:`dsh-pm-loading`,children:t(`client.state.loading`)}):x.error&&b?(0,a.jsx)(`div`,{className:`dsh-pm-error`,children:`${t(`client.state.error`)}：${x.error.message}`}):x.data?(0,a.jsx)(D,{text:x.data.text}):null:(0,a.jsx)(I,{q:n.q,overview:d,onOpenDoc:(e,t,n)=>f({kind:`doc`,path:e,name:t,label:n}),t});let w=n.kind===`section`?n.label:n.kind===`doc`?n.label||n.name:n.kind===`search`?t(`client.search.title`):t(`client.cards.heading`);return(0,a.jsxs)(`div`,{className:`dsh-pm-root`,"data-dsh-project-memory-panel":``,children:[(0,a.jsxs)(`div`,{className:`dsh-pm-bar`,children:[(0,a.jsxs)(`div`,{className:`dsh-pm-crumb`,children:[n.kind!==`cards`&&(0,a.jsx)(`button`,{type:`button`,className:`dsh-pm-crumb-back`,onClick:p,title:t(`client.doc.back`),children:`‹`}),(0,a.jsx)(`button`,{type:`button`,className:`dsh-pm-crumb-title`,onClick:m,children:t(`client.panel.title`)}),n.kind!==`cards`&&(0,a.jsx)(`span`,{className:`dsh-pm-crumb-sep`,children:`/`}),n.kind!==`cards`&&(0,a.jsx)(`span`,{className:`dsh-pm-crumb-title`,children:w})]}),(0,a.jsxs)(`div`,{className:`dsh-pm-search`,children:[(0,a.jsx)(`input`,{value:s,onChange:e=>c(e.target.value),onKeyDown:e=>{e.key===`Escape`&&c(``)},placeholder:t(`client.search.placeholder`),"aria-label":t(`client.search.placeholder`)}),(0,a.jsx)(`kbd`,{children:`Esc`})]}),d&&(0,a.jsx)(`span`,{className:`dsh-pm-count`,children:t(`client.meta.count`,{projects:d.projects.length,sources:d.sources.length})}),(0,a.jsxs)(`span`,{className:`dsh-pm-ro-badge`,children:[(0,a.jsx)(`span`,{className:`dsh-pm-ro-dot`}),t(`client.panel.readonly`)]}),e&&(0,a.jsx)(`button`,{type:`button`,className:`dsh-pm-close`,onClick:e,"aria-label":t(`client.doc.close`),children:`✕`})]}),(0,a.jsxs)(`div`,{className:`dsh-pm-body`,children:[(0,a.jsxs)(`nav`,{className:`dsh-pm-rail`,"aria-label":t(`client.panel.title`),children:[(0,a.jsxs)(`button`,{type:`button`,className:`dsh-pm-rail-item${n.kind===`section`&&n.sectionId===`global`?` is-active`:``}`,onClick:()=>f({kind:`section`,sectionId:`global`,label:t(`client.sections.global`)}),children:[(0,a.jsx)(N,{}),(0,a.jsx)(`span`,{children:t(`client.sections.global`)}),(0,a.jsx)(`span`,{className:`dsh-pm-rail-badge`,children:d?.global.exists?d.global.fileCount:0})]}),d?.global.exists&&(0,a.jsx)(`div`,{className:`dsh-pm-rail-note`,title:d.global.path,children:O(d.global.displayPath??d.global.path,44)}),(0,a.jsx)(`div`,{className:`dsh-pm-rail-group`,children:t(`client.sections.projects`)}),_.map(e=>{let t=g.get(e.id)??e.dir;return(0,a.jsxs)(`button`,{type:`button`,className:`dsh-pm-rail-sub${n.kind===`section`&&n.sectionId===e.id?` is-active`:``}`,onClick:()=>f({kind:`section`,sectionId:e.id,label:t}),title:e.pathExists===!1?`${e.displayPath??e.dir}（项目路径已不存在）`:e.displayPath??e.dir,children:[(0,a.jsx)(M,{size:12}),(0,a.jsxs)(`span`,{className:`dsh-pm-rail-sub-name`,children:[O(t,28),e.pathExists===!1?` ⚠`:``]}),(0,a.jsx)(`span`,{className:`dsh-pm-rail-badge`,children:e.fileCount})]},e.id)}),y.map(e=>{let t=g.get(e.id)??e.dir;return(0,a.jsxs)(`button`,{type:`button`,className:`dsh-pm-rail-sub${n.kind===`section`&&n.sectionId===e.id?` is-active`:``}`,onClick:()=>f({kind:`section`,sectionId:e.id,label:t}),title:e.pathExists===!1?`${e.displayPath??e.dir}（项目路径已不存在）`:e.displayPath??e.dir,children:[(0,a.jsx)(M,{size:12}),(0,a.jsxs)(`span`,{className:`dsh-pm-rail-sub-name`,children:[O(t,28),e.pathExists===!1?` ⚠`:``]}),(0,a.jsx)(`span`,{className:`dsh-pm-rail-badge`,children:e.fileCount})]},e.id)}),h.length>3&&(0,a.jsx)(`button`,{type:`button`,className:`dsh-pm-rail-fold`,onClick:()=>u(e=>!e),children:l?`▸ ${t(`client.fold.more`,{count:h.length-3})}`:`▾ ${t(`client.fold.less`)}`}),(0,a.jsx)(`div`,{className:`dsh-pm-rail-group`,children:t(`client.sections.sources`)}),(d?.sources??[]).map(e=>(0,a.jsxs)(`button`,{type:`button`,className:`dsh-pm-rail-sub${n.kind===`section`&&n.sectionId===`s:${e.id}`?` is-active`:``}`,onClick:()=>f({kind:`section`,sectionId:`s:${e.id}`,label:e.label}),children:[(0,a.jsx)(N,{size:12}),(0,a.jsx)(`span`,{className:`dsh-pm-rail-sub-name`,title:e.root,children:O(e.label,24)}),(0,a.jsx)(`span`,{className:`dsh-pm-rail-badge`,children:e.fileCount})]},e.id)),!d&&(0,a.jsx)(`div`,{className:`dsh-pm-rail-note`,children:t(`client.state.loading`)}),(0,a.jsx)(`div`,{className:`dsh-pm-rail-group`,children:t(`client.sections.knowledge`)}),(0,a.jsxs)(`button`,{type:`button`,className:`dsh-pm-rail-item is-disabled`,disabled:!0,title:t(`client.knowledge.reserved`),children:[(0,a.jsx)(N,{}),(0,a.jsx)(`span`,{children:t(`client.sections.knowledge`)}),(0,a.jsx)(`span`,{className:`dsh-pm-rail-badge`,children:`M3`})]})]}),(0,a.jsx)(`main`,{className:`dsh-pm-content`,children:C})]})]})}function R(){return`<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 2.5h2.6v11H2zM6 2.5h2.6v11H6z" stroke="currentColor" stroke-linejoin="round"/><path d="m10.2 3.3 2.5-.7 2 10.7-2.5.7z" stroke="currentColor" stroke-linejoin="round"/></svg>`}function z(){let e=document.querySelector(`[data-pane="sidebar"], [class*="sidebarCol"], .dshDesktopUpstreamSidebar, .dshDesktopSidebarSurface`);if(!e)return;let t=e.querySelector(`[class*="logoRow"]`);return t?.parentElement?t.parentElement:e.firstElementChild??e}function B(e){let t=e.querySelector(`button[class*="newSession"]`);if(t)return t;for(let t of Array.from(e.children))if(t!==e&&t.tagName===`BUTTON`)return t;return Array.from(e.querySelectorAll(`button[aria-label]`)).find(e=>/新建会话|新会话|New Session|new session/i.test(e.getAttribute(`aria-label`)??``))||Array.from(e.querySelectorAll(`button`)).find(e=>/新建会话|新会话|new session/i.test(e.textContent??``))}function V(e,t){let n=B(e)??e,r=n.parentElement??e,i=r.querySelectorAll(`[data-dsh-pm-entry], [data-dsh-atb-entry], [data-dsh-taskboard-entry], [data-dsh-ssh-entry]`),a=i.length?i[0]:n.nextElementSibling;return a&&a!==t?r.insertBefore(t,a):n.parentElement===e?e.insertBefore(t,n):e.appendChild(t),e.contains(t)}function H(e,t){let n=document.createElement(`button`);return n.type=`button`,n.className=`dsh-pm-entry`,n.dataset.dshPmEntry=``,n.title=e(),n.setAttribute(`aria-label`,e()),n.style.cssText=`display:flex;align-items:center;gap:7px;width:100%;padding:7px 10px;border:0;background:none;color:inherit;cursor:pointer;font:inherit;font-size:12.5px;border-radius:8px;text-align:left;`,n.innerHTML=`${R()}<span class="dsh-pm-entry-label"></span>`,n.querySelector(`.dsh-pm-entry-label`).textContent=e(),n.addEventListener(`mouseenter`,()=>{n.style.background=`rgba(128,128,128,0.12)`}),n.addEventListener(`mouseleave`,()=>{n.style.background=`none`}),n.addEventListener(`click`,()=>t()),n}function U(e,t){let n=[],r,i,a=!1,o=()=>{if(a)return!1;let n=z();return n?i&&i.isConnected&&n.contains(i)?!0:((!i||!i.isConnected)&&(i?.remove(),i=H(t,e)),V(n,i)):!1},s=new MutationObserver(()=>{o()&&s.disconnect()});s.observe(document.body,{childList:!0,subtree:!0}),n.push(s);let c,l=()=>{let e=z();!e||c||(c=new MutationObserver(()=>{!a&&i&&!i.isConnected&&o()}),c.observe(e,{childList:!0}),n.push(c))};return r=setInterval(()=>{o()&&l()},2e3),o(),l(),()=>{a=!0,r&&clearInterval(r);for(let e of n.splice(0))e.disconnect();i?.remove(),i=void 0}}let W=`dsh-project-memory`;function G(e){if(typeof e!=`object`||!e)return!1;let t=e;return typeof t.register==`function`&&typeof t.inject==`function`&&typeof t.spec==`function`}function K(e){try{let t=e.get?.(`slots`)??e.slots;return!G(t)||t.spec(`main`)===void 0||t.spec(`sidebar.panellist`)===void 0?void 0:t}catch{return}}function q(){return(0,a.jsx)(L,{})}function J({size:e}){return(0,a.jsxs)(`svg`,{width:e??15,height:e??15,viewBox:`0 0 16 16`,fill:`none`,"aria-hidden":`true`,children:[(0,a.jsx)(`path`,{d:`M2 2.5h2.6v11H2zM6 2.5h2.6v11H6z`,stroke:`currentColor`,strokeLinejoin:`round`}),(0,a.jsx)(`path`,{d:`m10.2 3.3 2.5-.7 2 10.7-2.5.7z`,stroke:`currentColor`,strokeLinejoin:`round`})]})}function Y(e){let t=[];try{return e.inject(`main`,()=>{let n=e.register({name:`main`,key:W},q);typeof n==`function`&&t.push(n)}),e.inject(`sidebar.panellist`,()=>{let n=e.register({name:`sidebar.panellist`,id:W,order:999,label:()=>h(`client.panel.entry`)},e=>(0,a.jsx)(J,{size:e?.size}));typeof n==`function`&&t.push(n)}),()=>{for(let e of t.splice(0).reverse())try{e()}catch{}}}catch{for(let e of t.splice(0))try{e()}catch{}return}}function X(){let e,t,n=()=>{try{t?.unmount()}catch{}t=void 0,e?.remove(),e=void 0};return{open(){if(e)return;e=document.createElement(`div`),e.className=`dsh-pm-overlay`,e.setAttribute(`data-dsh-project-memory-overlay`,``);let r=document.createElement(`div`);r.className=`dsh-pm-overlay-panel`,e.appendChild(r),e.addEventListener(`mousedown`,t=>{t.target===e&&n()}),document.body.appendChild(e),t=(0,i.createRoot)(r),t.render((0,a.jsx)(L,{onClose:n}))},dispose(){n()}}}function Z(e){let t=K(e);if(t){let e=Y(t);if(e)return e}let n=X(),r;try{r=U(()=>n.open(),()=>h(`client.panel.entry`))}catch(e){console.error(`[dsh-project-memory] sidebar entry failed:`,e)}let i,a=!1,o=0;return i=setInterval(()=>{o+=1;let t=K(e);t&&Y(t)&&(a=!0,r?.(),r=void 0,n.dispose()),(a||o>=3)&&(i&&clearInterval(i),i=void 0)},350),()=>{i&&clearInterval(i),i=void 0,r?.(),n.dispose()}}let Q;function $(){if(Q?.isConnected)return;let e=document.createElement(`style`);e.setAttribute(`data-dsh-project-memory`,`styles`),e.textContent=`
.dsh-pm-root {
  --dsh-pm-brand: var(--dsw-brand, #4d6bfe);
  --dsh-pm-brand-soft: var(--dsw-brand-soft, #eef1ff);
  --dsh-pm-bg: var(--dsw-bg, #f7f8fa);
  --dsh-pm-panel: var(--dsw-surface, #ffffff);
  --dsh-pm-line: var(--dsw-border, #e8eaee);
  --dsh-pm-text: var(--dsw-text, #1f2329);
  --dsh-pm-muted: var(--dsw-text-muted, #8a919f);
  --dsh-pm-mark: #fff1a8;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--dsh-pm-bg);
  color: var(--dsh-pm-text);
  font-size: 13px;
  line-height: 1.6;
  overflow: hidden;
}
.dsh-pm-root *, .dsh-pm-overlay * { box-sizing: border-box; }
.dsh-pm-root button { font: inherit; color: inherit; background: none; border: none; cursor: pointer; }
.dsh-pm-root :focus-visible { outline: 2px solid var(--dsh-pm-brand); outline-offset: 1px; }
@media (prefers-reduced-motion: reduce) {
  .dsh-pm-root *, .dsh-pm-overlay * { transition: none !important; animation: none !important; }
}

/* —— 顶栏 —— */
.dsh-pm-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: var(--dsh-pm-panel);
  border-bottom: 1px solid var(--dsh-pm-line);
  flex: none;
}
.dsh-pm-crumb { display: flex; align-items: center; gap: 6px; min-width: 0; }
.dsh-pm-crumb-title { font-weight: 600; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsh-pm-crumb-sep { color: var(--dsh-pm-muted); }
.dsh-pm-crumb-back {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 6px; color: var(--dsh-pm-brand);
}
.dsh-pm-crumb-back:hover { background: var(--dsh-pm-brand-soft); }
.dsh-pm-search {
  flex: 1 1 auto; min-width: 120px; max-width: 430px; margin-left: auto;
  display: flex; align-items: center; gap: 6px;
  padding: 5px 10px; border: 1px solid var(--dsh-pm-line); border-radius: 8px;
  background: var(--dsh-pm-bg);
}
.dsh-pm-search:focus-within { border-color: var(--dsh-pm-brand); background: var(--dsh-pm-panel); }
.dsh-pm-search input {
  flex: 1; min-width: 0; border: none; outline: none; background: transparent;
  color: inherit; font-size: 12.5px;
}
.dsh-pm-search kbd {
  flex: none; font-size: 10px; color: var(--dsh-pm-muted);
  border: 1px solid var(--dsh-pm-line); border-radius: 4px; padding: 0 4px;
}
.dsh-pm-count { flex: none; color: var(--dsh-pm-muted); font-size: 12px; white-space: nowrap; }
.dsh-pm-ro-badge {
  flex: none; display: inline-flex; align-items: center; gap: 5px;
  font-size: 11px; color: var(--dsh-pm-muted);
  padding: 2px 8px; border: 1px solid var(--dsh-pm-line); border-radius: 999px;
}
.dsh-pm-ro-dot { width: 6px; height: 6px; border-radius: 50%; background: #22a06b; }
.dsh-pm-close {
  flex: none; width: 24px; height: 24px; border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--dsh-pm-muted); font-size: 15px;
}
.dsh-pm-close:hover { background: var(--dsh-pm-bg); color: var(--dsh-pm-text); }

/* —— 主体布局 —— */
.dsh-pm-body { flex: 1; display: flex; min-height: 0; }
.dsh-pm-rail {
  flex: none; width: 236px; overflow-y: auto;
  border-right: 1px solid var(--dsh-pm-line);
  background: var(--dsh-pm-panel);
  padding: 8px 6px 16px;
}
.dsh-pm-content { flex: 1; min-width: 0; overflow-y: auto; padding: 14px 18px 40px; }

/* —— rail 分区 —— */
.dsh-pm-rail-item {
  display: flex; align-items: center; gap: 7px; width: 100%;
  padding: 6px 8px; border-radius: 7px; text-align: left;
  color: var(--dsh-pm-text);
}
.dsh-pm-rail-item:hover { background: var(--dsh-pm-bg); }
.dsh-pm-rail-item.is-active { background: var(--dsh-pm-brand-soft); color: var(--dsh-pm-brand); font-weight: 600; }
.dsh-pm-rail-item.is-disabled { color: var(--dsh-pm-muted); cursor: not-allowed; opacity: 0.62; }
.dsh-pm-rail-item.is-disabled:hover { background: none; }
.dsh-pm-rail-badge {
  margin-left: auto; flex: none; font-size: 10.5px; color: var(--dsh-pm-muted);
  background: var(--dsh-pm-bg); border-radius: 999px; padding: 0 7px;
}
.dsh-pm-rail-item.is-active .dsh-pm-rail-badge { background: var(--dsh-pm-panel); color: var(--dsh-pm-brand); }
.dsh-pm-rail-note {
  padding: 1px 8px 6px 23px; font-size: 10.5px; color: var(--dsh-pm-muted);
  white-space: nowrap; overflow: hidden;
}
.dsh-pm-rail-group {
  margin: 12px 8px 4px; font-size: 11px; font-weight: 600; color: var(--dsh-pm-muted);
  letter-spacing: 0.02em;
}
.dsh-pm-rail-sub {
  display: flex; align-items: center; gap: 6px; width: 100%;
  padding: 4px 8px 4px 23px; border-radius: 6px; text-align: left; color: var(--dsh-pm-text);
}
.dsh-pm-rail-sub:hover { background: var(--dsh-pm-bg); }
.dsh-pm-rail-sub.is-active { background: var(--dsh-pm-brand-soft); color: var(--dsh-pm-brand); font-weight: 600; }
.dsh-pm-rail-sub-name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; }
.dsh-pm-rail-fold {
  display: flex; align-items: center; gap: 6px; width: 100%;
  margin-top: 2px; padding: 5px 8px 5px 23px;
  font-size: 11.5px; color: var(--dsh-pm-muted); border-radius: 6px;
}
.dsh-pm-rail-fold:hover { background: var(--dsh-pm-bg); color: var(--dsh-pm-text); }

/* —— 列表行 —— */
.dsh-pm-group-h {
  margin: 16px 2px 8px; font-size: 11px; font-weight: 600; color: var(--dsh-pm-muted);
  letter-spacing: 0.02em;
}
.dsh-pm-group-h:first-child { margin-top: 2px; }
.dsh-pm-row {
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 9px 12px; border-radius: 9px; text-align: left;
  border: 1px solid var(--dsh-pm-line); background: var(--dsh-pm-panel);
  margin-bottom: 8px;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.dsh-pm-row:hover { border-color: var(--dsh-pm-brand); box-shadow: 0 1px 6px rgb(77 107 254 / 10%); }
.dsh-pm-row-icon { flex: none; color: var(--dsh-pm-brand); display: inline-flex; }
.dsh-pm-row-main { flex: 1; min-width: 0; }
.dsh-pm-row-title { font-weight: 600; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsh-pm-row-summary {
  color: var(--dsh-pm-muted); font-size: 12px; margin-top: 1px;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.dsh-pm-row-time { flex: none; color: var(--dsh-pm-muted); font-size: 11px; white-space: nowrap; }
.dsh-pm-row-mono { color: var(--dsh-pm-muted); font-size: 11px; font-family: ui-monospace, Consolas, monospace; }

/* —— 源卡片 —— */
.dsh-pm-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px; }
.dsh-pm-card {
  display: flex; flex-direction: column; gap: 6px; width: 100%;
  padding: 12px 14px; border-radius: 10px; text-align: left;
  border: 1px solid var(--dsh-pm-line); background: var(--dsh-pm-panel);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.dsh-pm-card:hover { border-color: var(--dsh-pm-brand); box-shadow: 0 1px 6px rgb(77 107 254 / 10%); }
.dsh-pm-card.is-dashed { border-style: dashed; }
.dsh-pm-card-head { display: flex; align-items: center; gap: 8px; font-weight: 600; }
.dsh-pm-card-desc { color: var(--dsh-pm-muted); font-size: 12px; }
.dsh-pm-card-path {
  color: var(--dsh-pm-muted); font-size: 11px; font-family: ui-monospace, Consolas, monospace;
  white-space: nowrap; overflow: hidden;
}

/* —— 阅读视图 —— */
.dsh-pm-doc-head { margin-bottom: 10px; }
.dsh-pm-doc-head h1 { font-size: 19px; margin: 2px 0 8px; }
.dsh-pm-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dsh-pm-pill {
  font-size: 11px; color: var(--dsh-pm-brand); background: var(--dsh-pm-brand-soft);
  border-radius: 999px; padding: 1px 9px;
}
.dsh-pm-pill.is-plain { color: var(--dsh-pm-muted); background: var(--dsh-pm-bg); }
.dsh-pm-pill.is-mono { font-family: ui-monospace, Consolas, monospace; }
.dsh-pm-article {
  max-width: 76ch; background: var(--dsh-pm-panel);
  border: 1px solid var(--dsh-pm-line); border-radius: 10px;
  padding: 18px 22px; font-size: 13.5px;
}
.dsh-pm-article h1, .dsh-pm-article h2, .dsh-pm-article h3 { margin: 18px 0 8px; line-height: 1.4; }
.dsh-pm-article h1 { font-size: 18px; } .dsh-pm-article h2 { font-size: 16px; } .dsh-pm-article h3 { font-size: 14px; }
.dsh-pm-article h1:first-child, .dsh-pm-article h2:first-child, .dsh-pm-article h3:first-child { margin-top: 0; }
.dsh-pm-article p { margin: 8px 0; }
.dsh-pm-article ul, .dsh-pm-article ol { margin: 8px 0; padding-left: 22px; }
.dsh-pm-article li { margin: 3px 0; }
.dsh-pm-article code {
  font-family: ui-monospace, Consolas, monospace; font-size: 12px;
  background: var(--dsh-pm-bg); border-radius: 4px; padding: 1px 5px;
}
.dsh-pm-article pre {
  background: #1f2329; color: #e8eaee; border-radius: 8px;
  padding: 10px 14px; overflow-x: auto; margin: 10px 0;
}
.dsh-pm-article pre code { background: none; color: inherit; padding: 0; font-size: 12px; }
.dsh-pm-article blockquote {
  margin: 10px 0; padding: 4px 12px; color: var(--dsh-pm-muted);
  border-left: 3px solid var(--dsh-pm-brand); background: var(--dsh-pm-brand-soft);
  border-radius: 0 6px 6px 0;
}
.dsh-pm-article a { color: var(--dsh-pm-brand); }
.dsh-pm-article hr { border: none; border-top: 1px solid var(--dsh-pm-line); margin: 14px 0; }

/* —— 搜索结果 —— */
.dsh-pm-sr-stat { margin: 2px 2px 12px; color: var(--dsh-pm-muted); font-size: 12px; }
.dsh-pm-sr-row {
  display: block; width: 100%; text-align: left;
  padding: 10px 12px; border-radius: 9px; margin-bottom: 8px;
  border: 1px solid var(--dsh-pm-line); background: var(--dsh-pm-panel);
}
.dsh-pm-sr-row:hover { border-color: var(--dsh-pm-brand); }
.dsh-pm-sr-path { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; min-width: 0; }
.dsh-pm-sr-name { font-weight: 600; font-size: 12.5px; }
.dsh-pm-sr-file {
  color: var(--dsh-pm-muted); font-size: 11px; font-family: ui-monospace, Consolas, monospace;
  white-space: nowrap; overflow: hidden;
}
.dsh-pm-sr-line { color: var(--dsh-pm-muted); font-size: 12px; padding: 1px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsh-pm-sr-line .dsh-pm-no { color: var(--dsh-pm-muted); opacity: 0.7; margin-right: 6px; font-family: ui-monospace, Consolas, monospace; font-size: 10.5px; }
.dsh-pm-mark { background: var(--dsh-pm-mark); border-radius: 2px; padding: 0 1px; }

/* —— 状态 —— */
.dsh-pm-empty {
  margin: 40px auto; max-width: 380px; text-align: center;
  border: 1px dashed var(--dsh-pm-line); border-radius: 12px; padding: 28px 20px;
  color: var(--dsh-pm-muted);
}
.dsh-pm-empty-title { font-weight: 600; color: var(--dsh-pm-text); margin-bottom: 4px; }
.dsh-pm-loading { margin: 40px auto; text-align: center; color: var(--dsh-pm-muted); }
.dsh-pm-error {
  margin: 40px auto; max-width: 460px; text-align: center;
  border: 1px solid #f4b8b8; background: #fdf3f3; border-radius: 12px; padding: 20px;
  color: #a33a3a; font-size: 12.5px; word-break: break-all;
}

/* —— legacy 覆盖层（官方插槽不可用时的降级容器） —— */
.dsh-pm-overlay {
  position: fixed; inset: 0; z-index: 2147483000;
  background: rgb(15 18 25 / 42%);
  display: flex; align-items: stretch; justify-content: center;
  padding: 4vh 5vw;
}
.dsh-pm-overlay-panel {
  flex: 1; min-width: 0; border-radius: 14px; overflow: hidden;
  box-shadow: 0 18px 60px rgb(0 0 0 / 30%);
}
`,document.head.appendChild(e),Q=e}let ee=[`connection`];function te(e){try{$();let t=m(e.get?.(`locale`)),n=[];try{n.push(Z(e))}catch(e){console.error(`[dsh-project-memory] mount failed:`,e)}e.effect?.(()=>()=>{for(let e of n.splice(0))e();t()},`dsh-project-memory: client mount`)}catch(e){console.error(`[dsh-project-memory] client half failed to start:`,e)}}return n.apply=te,n.inject=ee,n.name=`dsh-project-memory/client`,t.exports}});