import './TidelandsArticle.css';

// An article, as its report/articles/<Name>.pkl renders it to JSON.
export type Table = { columns: string[]; rows: string[][] };
export type Block = string | { text: string } | Table;
export type Article = {
  slug: string;
  title: string;
  dek: string;
  published: string;
  evidence: { what: string; state: string; note: string }[];
  watermark?: { severity: 'warning'; source: string; message: string } | null;
  sections: { heading?: string; blocks: Block[] }[];
};

export function ArticleView({ article, home = '/' }: { article: Article; home?: string }) {
  const w = article.watermark;
  return <article className={w ? 'td-article td-article-watermarked' : 'td-article'}>
    {w && <div className="td-article-watermark" role="note" aria-label={`${w.severity}: ${w.message}`}>
      <span className="td-article-watermark-diagnostic">
        <span aria-hidden="true">⚠</span> {w.severity}<span className="td-article-watermark-source">[{w.source}]</span>: {w.message}
      </span>
    </div>}
    <p className="td-article-home"><a href={home}>Richard Anthony</a></p>
    <h1>{article.title}</h1>
    <p className="td-article-dek">{article.dek}</p>
    <p className="td-article-date">{article.published}</p>
    <dl className="td-article-evidence" aria-label="What this article rests on">
      {article.evidence.map(e => <div key={e.what}>
        <dt>{e.what}</dt>
        <dd><strong>{e.state}</strong> {e.note}</dd>
      </div>)}
    </dl>
    {article.sections.map((s, i) => <section key={i}>
      {s.heading && <h2>{s.heading}</h2>}
      {s.blocks.map((b, j) => typeof b === 'string'
        ? <p key={j}>{b}</p>
        : 'columns' in b
          ? <div key={j} className="td-article-table"><table>
              <thead><tr>{b.columns.map(c => <th key={c} scope="col">{c}</th>)}</tr></thead>
              <tbody>{b.rows.map((r, k) => <tr key={k}>{r.map((v, m) => <td key={m}>{v}</td>)}</tr>)}</tbody>
            </table></div>
          : <pre key={j}><code>{b.text}</code></pre>)}
    </section>)}
  </article>;
}

/** The articles list on the homepage, newest first. */
export function ArticleList({ articles }: { articles: Article[] }) {
  const sorted = [...articles].sort((a, b) => b.published.localeCompare(a.published));
  return <section className="td-articles" aria-labelledby="articles-title">
    <h2 id="articles-title">Writing</h2>
    {sorted.map(a => <div key={a.slug} className="td-articles-item">
      <p><a href={`/articles/${a.slug}/`}>{a.title}</a></p>
      <p className="td-articles-dek">{a.dek}</p>
    </div>)}
  </section>;
}

export default function TidelandsArticles() {
  const articles = Object.values(import.meta.glob<Article>('./report/articles/*.json', { eager: true, import: 'default' }));
  return <ArticleList articles={articles} />;
}
