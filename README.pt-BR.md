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
pi install "$(npm root -g)/@abelxiaoxing/cadence"
```

`cadence server install` registra e inicia um serviço em segundo plano (systemd no Linux, um LaunchAgent no macOS, uma entrada de login no Windows) e imprime um link privado, `http://127.0.0.1:17423/?token=…`.
O último comando permite que o Pi carregue a mesma cópia para o `/cadence`, então um único upgrade do npm atualiza ambos.
A porta e o token ficam em `~/.pi/agent/cadence/.env`; qualquer pessoa com o token pode usar seu espaço de trabalho, então mantenha o link privado.

## Uso

### No navegador

1. Abra o link impresso uma vez; o navegador então se lembra de você.
   Se você o perder, `cadence token-link --reveal` o imprime de novo.
2. Escolha uma pasta de projeto.
   A preferência de modelo salva é reutilizada ao enviar; escolha uma vez se ela não existir.
3. Envie `/cadence [objetivo]` uma vez.
   Esta conversa permanece no modo Cadence; esclareça os requisitos com mensagens normais.
4. Revise o plano completo e clique em **Implement this plan**.
   Implementação, verificações, reparos limitados e entrega local acordada são automáticos.
5. Acompanhe o progresso na conversa; abra os registros dos subagentes no painel **Subagents**, no canto inferior esquerdo.
   Atualizar a página ou concluir um objetivo não desativa o modo.
   **Exit Cadence** sai do modo; **Cancel workflow — request stop** solicita o cancelamento.

No live Pi terminal is required for the browser conversation workflow.

### No terminal

Digite `/cadence <objetivo>` uma vez e continue conversando normalmente.
O Cadence investiga o projeto, esclarece decisões e prepara um plano.
Após aprovação explícita, executa a implementação, verificações, reparos limitados e integração local acordada.

O modo permanece ativo durante toda a conversa, mesmo após concluir um objetivo.
Digite `exit cadence` para sair; sair não cancela trabalho aceito.
As preferências de modelo são mantidas entre projetos em `~/.pi/agent/cadence/settings.json`.

O proprietário local inicia sob demanda; o serviço do sistema é opcional para WebUI/inicialização automática.

`/cadence-history [run-id]`: readonly run details and retained history; no service startup or task execution.
See [History and diagnostics](docs/history.md).
[Conversation mode](docs/conversation-mode.md): native/browser approval, limits and worktree setup.
Browser authentication is not execution consent.

### Mais projetos

```sh
cadence project open /absolute/project
cadence project open /absolute/new-project --create
```

Cada projeto recebe seu próprio owner, porta e histórico, e o comando imprime seu link privado; o seletor de pastas da interface web abre projetos da mesma maneira.
Abrir outro projeto nunca interrompe o trabalho no anterior.

### Verificações

Os comandos de verificação constam do plano aprovado, incluindo verificações iniciais e de aceitação.
Os resultados reais permanecem separados da revisão automática do agente.

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
