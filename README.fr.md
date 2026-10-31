# Cadence

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md) · [Русский](README.ru.md)

Cadence transforme [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) en espace de travail de tâches persistant.
Planifiez une tâche de code, laissez les sous-agents y travailler, exécutez vos vérifications et examinez le résultat depuis le terminal Pi (`/cadence`) ou l'interface Web du navigateur ; les deux se connectent au même service en arrière-plan.

## Pourquoi Cadence

- **Le travail survit à la fenêtre.**
  Les tâches s'exécutent dans un service en arrière-plan : fermer le terminal, quitter Pi ou quitter l'onglet du navigateur ne fait que déconnecter, et chaque client peut se reconnecter à la même exécution.
- **Rien n'est modifié avant votre approbation.**
  Une tâche analyse d'abord en lecture seule et propose un plan lisible ; les fichiers ne changent qu'après que vous ayez confirmé ce plan exact.
- **Des résultats fiables.**
  La sortie des sous-agents, les exécutions réelles de vérifications et votre propre examen restent distincts : le texte du modèle ou un « Done » ne compte jamais comme une vérification passée, et les résultats échoués, annulés et inconnus restent distincts.
- **Historique complet.**
  Chaque exécution conserve ses messages, appels d'outils et sorties, avec recherche exacte et export Markdown/NDJSON complets ; les secrets connus sont masqués.
- **Un lien pour tout.**
  L'interface Web (bureau et téléphone, anglais et chinois simplifié) accueille également les conversations Pi ordinaires et bascule entre les projets, chacun avec son propre owner et son historique.

Cadence est un assistant de confiance, **pas un bac à sable** : ses agents modifient directement votre copie de travail avec les outils de l'hôte, utilisez-le donc sur du code que vous pouvez examiner et récupérer.

## Installation

Il vous faut Node `>=22.19.0` avec npm, et Pi installé et connecté à un fournisseur de modèles ; Cadence réutilise la connexion et les réglages de modèles de Pi.

```sh
npm install -g @abelxiaoxing/cadence
pi install "$(npm root -g)/@abelxiaoxing/cadence"
```

`cadence server install` enregistre et démarre un service en arrière-plan (systemd sur Linux, un LaunchAgent sur macOS, une entrée de connexion sur Windows) et affiche un lien privé, `http://127.0.0.1:17423/?token=…`.
La dernière commande permet à Pi de charger la même copie pour `/cadence`, donc une mise à niveau npm met à jour les deux.
Le port et le jeton se trouvent dans `~/.pi/agent/cadence/.env` ; quiconque possède le jeton peut utiliser votre espace de travail, gardez donc le lien privé.

## Utilisation

### Dans le navigateur

1. Ouvrez le lien affiché une fois ; le navigateur vous mémorise ensuite.
   Si vous le perdez, `cadence token-link --reveal` l'affiche à nouveau.
2. Choisissez un dossier de projet.
   La préférence de modèle est réutilisée à l’envoi ; choisissez une fois si elle est absente.
3. Envoyez une fois `/cadence [objectif]`.
   Cette conversation reste en mode Cadence ; précisez les besoins par des messages ordinaires.
4. Lisez le plan complet et cliquez sur **Implement this plan**.
   L’implémentation, les vérifications, les réparations bornées et la livraison locale convenue sont automatiques.
5. Suivez la progression dans la conversation ; ouvrez les traces des sous-agents depuis le panneau **Subagents** en bas à gauche.
   Actualiser ou terminer un objectif ne quitte pas le mode.
   **Exit Cadence** quitte le mode ; **Cancel workflow — request stop** demande l’annulation.

**Legacy task**: previous task/history workflow.
No live Pi terminal is required for the browser conversation workflow.

### Dans le terminal

Saisissez `/cadence <objectif>` une seule fois, puis poursuivez la conversation normalement.
Cadence étudie le projet, clarifie les décisions et prépare un plan.
Après votre approbation explicite, il réalise les modifications, vérifications, réparations limitées et intégration locale convenues.

Le mode reste actif pendant toute la conversation, même après la fin d’un objectif.
Saisissez `exit cadence` pour quitter ; cela n’annule pas le travail accepté.
Les préférences de modèle sont conservées entre projets dans `~/.pi/agent/cadence/settings.json`.

Le propriétaire local démarre à la demande ; le service système est facultatif pour la WebUI et le démarrage automatique.

`/cadence-inspect`: legacy task/history UI.
[Conversation mode](docs/conversation-mode.md): native/browser approval, limits and worktree setup.
Browser authentication is not execution consent.

### Plus de projets

```sh
cadence project open /absolute/project
cadence project open /absolute/new-project --create
```

Chaque projet reçoit son propre owner, son port et son historique, et la commande affiche son lien privé ; le sélecteur de dossiers du WebUI ouvre les projets de la même manière.
Ouvrir un autre projet n'arrête jamais le travail du précédent.

### Vérifications

Listez les commandes qui vérifient votre projet dans `.cadence/assistant/config.json`, et les tâches peuvent les exécuter comme de véritables vérifications avant l'examen :

```json
{
  "schema": "cadence-assistant-checks/1",
  "checks": [{ "name": "Tests", "command": "bun run test", "timeoutMs": 120000 }]
}
```

## Gérer le service

```sh
cadence server status
cadence server restart     # après une mise à niveau ou un changement de .env / models.json
cadence server stop        # reste enregistré et redémarre au prochain boot ou connexion
cadence server uninstall   # à exécuter avant npm uninstall -g
```

Mettez à niveau avec `npm install -g @abelxiaoxing/cadence@latest`, puis `cadence server restart`.
Restart, stop et uninstall arrêtent le travail en cours dans l'ordre au lieu de le laisser déconnecté.
Uninstall supprime uniquement la définition du service ; les projets, l'historique et les réglages de Pi restent.
Les services racine Linux et nommés, l'accès HTTPS distant et la récupération sont couverts par [gestion du service](docs/service-management.md) et [accès distant](docs/remote-access.md).

## Développement

Pi peut aussi charger un checkout local ou une archive tarball packagée : ajoutez son chemin absolu ou relatif aux `packages` de Pi, ou essayez `pi -e ./cadence`.
Cadence n'impose pas de plage de versions de Pi ; les versions figées de développement et les temps d'exécution testés ne sont pas des promesses de compatibilité universelles.

```sh
bun install
CADENCE_BROWSER_PATH=/absolute/existing/chromium bun run verify
```

Les conseils d'ingénierie sont répartis par domaine sous [engineering/](engineering/) ; l'index du projet dans [AGENTS.md](AGENTS.md) indique quel fichier couvre quel code.
`verify` nécessite aussi un build Node officiel, un répertoire temporaire privé et un Chromium existant ; voir [vérification](engineering/verification.md).

## Licence

Cadence est sous licence MIT.
Les adaptations, polices et vendeurs inclus conservent leurs propres licences ; voir [réutilisation et distribution](docs/reuse-and-distribution.md) et [avis tiers](THIRD_PARTY_NOTICES.md).
