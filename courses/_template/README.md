# 新しい教材（コース）を追加する方法

このアプリはコンテンツを一切持たず、`/courses` 以下のJSONファイルだけを読み込んで動作します。
新しい教材（例: CABG, AVR, EVAR, MitraClip, ABSITE, 面接対策...）を追加する手順は次の通りです。

## 1. フォルダを作る

```
/courses
  /cabg          ← 新しい教材のID（英数字・ハイフン推奨、URLの一部になります）
    course.json
    atomic_cards.json
    quiz_questions.json
```

`_template` フォルダの3ファイルをコピーして書き換えるのが最も簡単です。

## 2. course.json を書く

| フィールド | 内容 |
|---|---|
| `id` | フォルダ名と一致させてください |
| `title` / `shortTitle` | ホーム画面のカードに表示される教材名 |
| `description` | カードに表示される一言説明 |
| `longDescription` | 教材トップ画面に表示される詳しい説明 |
| `icon` | 絵文字1文字（例: 🫀 📚 🩻） |
| `color` | アクセントカラー（16進） |
| `cardsFile` / `quizFile` | 同フォルダ内のファイル名（通常は変更不要） |
| `chapters` | Learn Modeで学習する順番。**Atomic Knowledge Cardの `category` の値と完全一致させてください** |
| `bonusChapters` | 任意。全章クリア後に解放されるおまけの章 |
| `passThreshold` | 章末クイズの合格ライン（%） |
| `chapterQuizSize` | 章末クイズの最大問題数 |

## 3. atomic_cards.json / quiz_questions.json を書く

TAVIコースと全く同じスキーマです。詳しくは `_template` フォルダのサンプル、または
`/courses/tavi/atomic_cards.json` ・ `/courses/tavi/quiz_questions.json` を参考にしてください。

- 1カードにつき1つの知識だけを入れる
- `category` は course.json の `chapters` / `bonusChapters` のいずれかと一致させる
- `importance` は 3〜5（★の数）
- クイズの `type` は `multiple_choice` / `true_false` / `fill_blank` の3種類

## 4. courses.json に登録する

GitHub Pagesなどの静的ホスティングではフォルダの自動一覧取得ができないため、
`/courses/courses.json` に教材IDを追加してください。

```json
{
  "courses": ["tavi", "cabg"]
}
```

これだけで、アプリのホーム画面に新しい教材カードが自動的に表示されます。
アプリ本体のコード（`app/app.js` など）は一切変更する必要はありません。

## 5. 学習履歴について

学習履歴（回答数・正答率・章の合格状況・ブックマークなど）は教材ごとに
別々の LocalStorage キーで保存されるため、教材を追加しても既存の履歴には影響しません。

## 将来の拡張について

現在サポートしているコンテンツ形式は「Atomic Knowledge Card」と「クイズ問題」の2種類です。
将来的に動画・画像・PDF・症例ベース問題・チェックリストなどを追加する場合は、
`course.json` に新しいコンテンツ種別を宣言できるようフィールドを追加し（例: `casesFile`, `checklistsFile`）、
`app/app.js` 側に対応するレンダラーを追加する形で拡張してください。
アプリ本体とコンテンツが分離されているため、既存教材のデータ構造には影響しません。
