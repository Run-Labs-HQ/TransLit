# TransLit (Français)

TransLit est un plugin Zotero orienté articles académiques, avec deux flux principaux :

1. Traduction du texte intégral PDF via DeepSeek (sortie en pièce jointe Markdown)
2. Extraction des figures/tableaux via MinerU avec visualisation dans Zotero

## Fonctions principales

- Clic droit `翻译全文（DeepSeek）` :
  - extraction du texte PDF via Zotero
  - appel `deepseek-reasoner` avec prompt configurable
  - sauvegarde en fichier `.md` attaché à la référence
- Clic droit `解析图表资源（MinerU）` :
  - envoi du PDF à MinerU
  - suivi de statut et téléchargement du résultat
  - génération des pièces jointes `zip/summary/manifest/merged-manifest`
- Clic droit `查看图表结果（MinerU）` :
  - bascule rapide `f1/f2/.../t1...`
  - zoom (roulette) + déplacement (drag)
  - affichage des légendes chinoises

## Développement

```bash
npm install
npm start
```

## Vérification

```bash
npm run lint:check
npm run build
npm run test -- --no-watch
```

## Paramètres

Configurer dans les préférences TransLit de Zotero :

- DeepSeek API Key
- DeepSeek Base URL
- Modèle de prompt DeepSeek
- MinerU API Token
- MinerU Base URL
- MinerU Model Version

Placeholders du prompt : `{{title}}`, `{{itemKey}}`, `{{content}}`.

## Sécurité

- Les secrets sont stockés via le gestionnaire d’identifiants quand disponible
- Les anciennes préférences en clair sont migrées et nettoyées automatiquement

## Dépôt

- https://github.com/Run-Labs-HQ/TransLit

## Remerciements

TransLit est construit à partir du template open source suivant :

- https://github.com/windingwind/zotero-plugin-template
