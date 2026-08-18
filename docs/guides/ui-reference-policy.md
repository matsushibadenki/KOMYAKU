# UI Reference Material Policy

## 日本語

`references/`以下のパーツ素材は、KOMYAKUのButton、List、Menu、Tabs、Toolbar、Text Field、Selection Control等を設計・実装するときの参考資料として使用する。

次の原則を守る。

- 参考素材のHTML、CSS、JavaScript、画像、URLへProduction Codeから直接Link、Import、Embedしない。
- 参考素材のComponentをそのままCopyせず、意図、状態、寸法、余白、階層、操作感を読み取り、KOMYAKU固有のComponent APIとDesign Tokenで再作成する。
- Build、Test、Runtimeを`references/`の存在や外部Symlinkの解決に依存させない。
- 実装はKOMYAKU Repository内に置き、Source、License、Test、Maintenanceの境界を明確にする。
- 標準版とCompact版を用意する。Compact版もPointer操作領域を原則44×44 CSS px以上に保つ。
- Default、Hover、Focus、Active/Pressed、Selected/Checked、Disabled、Loading、Error等、Componentに必要な状態を明示して検証する。
- Keyboard操作、Focus表示、Semantic role/name、Contrast、Reduced Motion、Screen Readerを考慮する。
- Light/Dark Theme、日本語、英語、简体中文、長いLabel、狭い画面で確認する。
- 色だけで状態や意味を伝えず、Text、Icon、Shape、Border等を併用する。
- Mobile LayoutではSafe Area、左右16pt以上の基本余白、44pt以上の操作領域を守る。

参考資料とKOMYAKU実装に差がある場合は、KOMYAKUのProduct要件、アクセシビリティ、国際化、安全性を優先し、重要な差分をdocsへ記録する。

## English

Use the component material under `references/` as design and behavior input when implementing KOMYAKU buttons, lists, menus, tabs, toolbars, text fields, and selection controls.

- Do not link, import, embed, or load reference HTML, CSS, JavaScript, images, or URLs from production code.
- Do not copy components verbatim. Recreate their intent, states, dimensions, spacing, hierarchy, and interaction behavior through KOMYAKU-owned component APIs and design tokens.
- Builds, tests, and runtime behavior must not depend on `references/` or on resolving an external symlink.
- Provide standard and compact variants while preserving a minimum 44×44 CSS px pointer target in compact controls.
- Verify applicable default, hover, focus, pressed, selected, disabled, loading, and error states.
- Support keyboard use, visible focus, semantic names and roles, contrast, reduced motion, and screen readers.
- Verify light/dark themes, Japanese/English/Simplified Chinese, long labels, and narrow layouts.
- Never communicate state through color alone.

When the reference conflicts with KOMYAKU product requirements, accessibility, internationalization, or security, KOMYAKU requirements take precedence and material differences must be documented.

## 简体中文

在实现KOMYAKU的按钮、列表、菜单、标签页、工具栏、文本字段和选择控件时，将`references/`目录下的组件素材作为设计与交互参考。

- Production Code不得直接链接、导入、嵌入或加载参考素材中的HTML、CSS、JavaScript、图片或URL。
- 不得原样复制组件；应理解其设计意图、状态、尺寸、间距、层级与操作方式，并使用KOMYAKU自有的Component API和Design Token重新实现。
- Build、Test和Runtime不得依赖`references/`目录或外部Symlink。
- 提供标准版和Compact版；Compact控件的Pointer操作区域原则上仍须达到44×44 CSS px。
- 验证适用的默认、Hover、Focus、Pressed、Selected、Disabled、Loading和Error状态。
- 支持键盘操作、清晰的Focus、语义化名称与Role、对比度、Reduced Motion和Screen Reader。
- 验证亮色／深色主题、日语／英语／简体中文、长标签和窄屏布局。
- 不得只用颜色表达状态或含义。

如果参考素材与KOMYAKU的产品需求、无障碍、多语言或安全要求冲突，应优先遵循KOMYAKU要求，并在docs中记录重要差异。
