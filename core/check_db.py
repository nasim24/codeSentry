import sqlite3

conn = sqlite3.connect('../reviewer.db')
conn.row_factory = sqlite3.Row

print('=== MRS TABLE ===')
mrs = conn.execute('SELECT mr_iid, title, last_commit_sha, status FROM mrs').fetchall()
for m in mrs:
    print(f"  MR !{m['mr_iid']} | sha: {m['last_commit_sha']} | {m['title']}")

print()
print('=== REVIEWS TABLE ===')
reviews = conn.execute('SELECT mr_iid, score, commit_sha, reviewed_at FROM reviews').fetchall()
for r in reviews:
    print(f"  MR !{r['mr_iid']} | score: {r['score']} | sha: {r['commit_sha']} | {r['reviewed_at']}")

conn.close()