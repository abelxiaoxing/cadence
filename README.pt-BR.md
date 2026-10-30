# Cadence

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md) · [Русский](README.ru.md)

O Cadence transforma o [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) em um espaço de trabalho de tarefas persistente.
Planeje uma tarefa de código, deixe os subagentes trabalharem nela, execute suas verificações e revise o resultado no terminal do Pi (`/cadence`) ou na interface web do navegador; ambos se conectam ao mesmo serviço em segundo plano.

## Por que o Cadence

- **O trabalho sobrevive à janela.**
  As tarefas rodam em um serviço em segundo plano: fechar o terminal, sair do Pi ou deixar a aba do navegador apenas desconecta, e qualquer cliente pode se reconectar à mesma execução.
- **Nada é editado antes de você aprovar.**
  Uma tarefa primeiro analisa em somente leitura e propõe um plano legível; os arquivos mudam apenas depois que você confirma esse plano exato.
- **Resultados nos quais você pode confiar.**
  A saída dos subagentes, as execuções reais de verificação e a sua própria revisão permanecem separadas: a prosa do modelo ou um "Done" nunca contam como verificação aprovada, e resultados com falha, cancelados e desconhecidos permanecem distintos.
- **Histórico completo.**
  Cada execução mantém suas mensagens, chamadas de ferramentas e saídas, com busca exata e exportação completa em Markdown/NDJSON; segredos conhecidos são redigidos.
- **Um link para tudo.**
  A interface web (desktop e celular, inglês e chinês simplificado) também hospeda conversas comuns do Pi e alterna entre projetos, cada um com seu próprio owner e histórico.

O Cadence é um assistente confiável, **não uma caixa de areia**: seus agentes editam sua cópia de trabalho diretamente com as ferramentas do host, então use-o apenas em código que você possa revisar e recuperar.

## Instalação

Você precisa de Node `>=22.19.0` com npm, e do Pi instalado e conectado a um provedor de modelos; o Cadence reutiliza o login e as configurações de modelos do Pi.

```sh
npm install -g @abelxiaoxing/cadence
cadence server install
pi install "$(npm root -g)/@abelxiaoxing/cadence"
```

`cadence server install` registra e inicia um serviço em segundo plano (systemd no Linux, um LaunchAgent no macOS, uma entrada de login no Windows) e imprime um link privado, `http://127.0.0.1:17423/?token=…`.
O último comando permite que o Pi carregue a mesma cópia para o `/cadence`, então um único upgrade do npm atualiza ambos.
A porta e o token ficam em `~/.pi/agent/cadence/.env`; qualquer pessoa com o token pode usar seu espaço de trabalho, então mantenha o link privado.

## Uso

### No navegador

1. Abra o link impresso uma vez; o navegador então se lembra de você.
   Se você o perder, `cadence token-link --reveal` o imprime de novo.
2. Escolha uma pasta de projeto com o botão de pasta no canto inferior direito, e escolha um modelo.
3. Envie uma mensagem para uma conversa comum, ou comece com `cadence <goal>` (ou selecione Tarefa Cadence) para criar uma tarefa.
4. Quando a análise propuser um plano, abra **Revisar plano de implementação** e escolha **Confirmar plano e executar**.
5. Acompanhe os subagentes no dock no canto inferior esquerdo; verificações, alterações e revisão ficam sob **Detalhes da tarefa** à direita.

### No terminal

No TUI do Pi, digite `/cadence [goal]` e pressione Enter você mesmo; entrada colada ou via script não o abre.
Escolha um modelo, crie ou abra uma tarefa, edite seu plano e confirme Start; os menus também mostram subagentes, verificações, alterações, revisão e histórico.

Cada sessão do Pi também mostra agentes em segundo plano em execução acima da entrada: pressione ↓ em uma entrada vazia para selecionar um e Enter para ler sua transcrição (`CADENCE_AGENT_PANEL=off` oculta o painel).

### Mais projetos

```sh
cadence project open /absolute/project
cadence project open /absolute/new-project --create
```

Cada projeto recebe seu próprio owner, porta e histórico, e o comando imprime seu link privado; o seletor de pastas da interface web abre projetos da mesma maneira.
Abrir outro projeto nunca interrompe o trabalho no anterior.

### Verificações

Liste os comandos que verificam seu projeto em `.cadence/assistant/config.json`, e as tarefas podem executá-los como verificações reais antes da revisão:

```json
{
  "schema": "cadence-assistant-checks/1",
  "checks": [{ "name": "Tests", "command": "bun run test", "timeoutMs": 120000 }]
}
```

## Gerenciar o serviço

```sh
cadence server status
cadence server restart     # após um upgrade ou uma alteração de .env / models.json
cadence server stop        # permanece registrado e inicia de novo no próximo boot ou login
cadence server uninstall   # executar antes de npm uninstall -g
```

Faça upgrade com `npm install -g @abelxiaoxing/cadence@latest`, depois `cadence server restart`.
Restart, stop e uninstall param o trabalho em execução em ordem, em vez de deixá-lo desconectado.
Uninstall remove apenas a definição do serviço; projetos, histórico e configurações do Pi permanecem.
Serviços root e nomeados do Linux, acesso HTTPS remoto e recuperação estão cobertos em [gerenciamento do serviço](docs/service-management.md) e [acesso remoto](docs/remote-access.md).

## Desenvolvimento

O Pi também pode carregar um checkout local ou um tarball empacotado: adicione seu caminho absoluto ou relativo aos `packages` do Pi, ou experimente `pi -e ./cadence`.
O Cadence não impõe uma faixa de versões do Pi; fixações de desenvolvimento e tempos de execução testados não são promessas universais de compatibilidade.

```sh
bun install
CADENCE_BROWSER_PATH=/absolute/existing/chromium bun run verify
```

As orientações de engenharia são divididas por área sob [engineering/](engineering/); o índice do projeto em [AGENTS.md](AGENTS.md) diz qual arquivo cobre qual código.
`verify` também precisa de um build oficial do Node, um diretório temporário privado e um Chromium existente; veja [verificação](engineering/verification.md).

## Licença

O Cadence é MIT.
Adaptações, fontes e vendors incluídos mantêm suas próprias licenças; veja [reutilização e distribuição](docs/reuse-and-distribution.md) e [avisos de terceiros](THIRD_PARTY_NOTICES.md).
