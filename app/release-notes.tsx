import {APP_VERSION,RELEASES} from '../lib/releases';
export default function ReleaseNotes({basePath}:{basePath:string}){
 return <div className="release-notes"><h2 id="release-title">版本與更新紀錄</h2><p>目前遊戲版本 <strong>{APP_VERSION}</strong></p><p className="panel-note">這是泰坦遠征網頁版的版本號；玩法參考點擊泰坦二代 7.5，兩者不同。較早更新當時尚未標記版本號。</p>
 {RELEASES.map((release,i)=><article key={i} className="release-entry"><time dateTime={release.date}>{release.date}</time><h3>{release.title}{release.version&&<span className="release-badge">{release.version}</span>}</h3><ul>{release.changes.map(change=><li key={change}>{change}</li>)}</ul></article>)}
 <aside className="release-pending"><h3>仍在開發</h3><p>完整六流派戰鬥、公會突襲、部分增益、特殊套裝觸發與原版成長曲線尚未完成。</p><a href={`${basePath}rules.html`} target="_blank" rel="noreferrer">查看已還原功能與差異 ↗</a></aside></div>;
}
