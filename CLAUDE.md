# デスゲーム主催者シミュレータ（試作 v4）

- 依頼文: ../claude-package/PROMPT.md（同梱パッケージ）。設計メモ: DESIGN.md。報告と質問: REPORT.md。
- ルールは sim.js（画面なし）、画面は ui.js / index.html。ボットは bot/run.js、文字どおりテストは tests.js、画面検査は tools/check.js。
- 質問はチャットでせず REPORT.md の「質問」の章に番号つきで書く（C:\Users\nonus\.claude\CLAUDE.md のきまり）。
- 同梱の試し音源（audio/）は依頼主の OK が出るまで組み込まない（audio/AUDIO-NOTE-for-claude.txt）。

## Game development standard entry v1.2
ゲーム作業の最初に [全ゲーム共通標準](docs/game-development/GAME-DEVELOPMENT-STANDARD.md) を読む。
[独立レビュー手順](docs/game-development/REVIEW-PROCEDURE.md) と [引継ぎ書式](docs/game-development/HANDOFF-TEMPLATE.md) を使う。
dot が制作担当と異なる独立担当を指定する。独立担当が未確保なら完了にしない。担当は読んだ版・パス・時刻を返す。
同時に動いている制作・LOCK・対象commitを確認してから着手する。画面と通常入力はコードレビューとは別に実証する。
