# ADR-076: Academic submission export profiles

- Status: Accepted
- Date: 2026-09-01

## Context

数学者、物理学者、研究者向けの数式入力を提供する場合、執筆後に論文投稿サイトや出版社の指定形式へ変換する経路も必要になる。投稿先ごとにLaTeX Class、Bibliography、Figure、Metadata、匿名化、File名、容量、Compiler等の要件が異なり、同じ投稿先でも要件が更新される。

投稿サイト固有の構造をCanonical Documentへ埋め込むと、保存した原稿が外部仕様変更へ引きずられる。逆に、単純なPDF ExportだけではSource提出、再現可能なCompile、Reference、Figure、Supplementary Material、Machine-readable XML等を求めるWorkflowへ対応できない。

## Decision

- Academic Submission Exportを、Canonical Documentから派生するVersioned Export Profileとして実装する。
- 初期Profileは`generic-latex-bundle`と`review-pdf-package`を対象とする。投稿先固有Profile、JATS XML、DOCX、Supplementary Datasetは後続Adapterとする。
- ProfileはID、Schema Version、取得した投稿要件のRevision、Renderer／Compiler Version、Template digest、Validation Rule digestを持つ。外部要件を無期限に正しいものとして固定しない。
- Export対象は利用者が明示的に選んだ一つのDocument VersionとBranchだけとする。Draft、別Branch、Comment、Recovery Snapshot、AI Prompt、内部Audit、削除済み本文、共有TokenをPackageへ混入させない。
- 生成PackageにはMain source、Bibliography、Figure／Table Asset、Supplementary file、Metadata、Build instruction、Manifest、SHA-256を含める。`.komyaku` Archiveは長期保存・再編集用であり、投稿用Packageと同一視しない。
- LaTeXをCanonical Equation sourceから生成し、MathMLは必要なProfileだけで派生生成する。認識Model由来のEquationも、利用者が確定したLaTeXだけを出力する。
- CompileはNetwork、Shell escape、外部File accessを拒否する隔離Workerで行う。Compiler、Package、Fontを固定し、Resource、File count、展開、時間、出力容量を制限する。
- 変換後はSubmission Readiness Reportを生成する。Errorは提出を止め、Warningは利用者が確認できる。自動修正は原Canonical Documentを黙って変更しない。
- 初期段階では投稿サイトへの自動Login、自動Upload、最終Submitを行わない。利用者がPackageとReportを確認し、自身で投稿する。
- 将来API投稿を追加する場合も、Provider Adapter、最小権限Credential、送信直前の明示確認、送信Receipt、再送防止Idempotency、Site Termsの確認を必須にする。

## Submission readiness checks

- Title、Abstract、Keywords、Author／Affiliation、Corresponding Author、Language等のProfile必須Metadata
- ORCID等のIdentifier形式。ただし個人情報を通常Logへ出さない
- Double-blind ProfileでのAuthor、Affiliation、Acknowledgement、PDF Metadata、File名、画像Metadataの漏洩
- Reference未解決、Citation key重複、Bibliography欠落
- Equation source validation、Figure／Table参照欠落、Caption、Alt text
- Figure format、Dimension、解像度、Color profile、容量
- Main file、Supplementary file、総容量、File名、Path、禁止拡張子
- Font embedding、Page size、Margin等、Profileが検査可能なPDF条件
- License、Funding、Conflict of Interest、Data availability等のRequired statement

## Consequences

Canonical Documentと投稿サイト仕様を分離でき、同じ論文Versionから複数の投稿先Packageを再生成できる。Profile、Compiler、Template、Source Versionの組合せがManifestへ残るため、提出物の再現とDiffが可能になる。

投稿要件は外部状態であり、Profile更新とConformance fixtureの維持が継続的に必要になる。KOMYAKUは「投稿可能」と断定せず、検査できた項目、未検査項目、Profile取得日をReportへ明示する。

