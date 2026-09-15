/* Experimental, unshipped Win32 Job supervisor. Wire: nine LE uint32s,
 * then four sized UTF-16LE strings (exe, CRT command line, cwd, env block).
 * Remaining stdin is control: any byte or EOF cancels. No inherited Job handle.
 * Native qualification, not source assertions, establishes API behavior. */
#define _WIN32_WINNT 0x0601
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

static HANDLE controlEvent;
static volatile LONG watchdogMs = 5000;
static DWORD WINAPI watchdogThread(LPVOID unused) {
  ULONGLONG start = GetTickCount64();
  (void)unused;
  for (;;) {
    if (GetTickCount64() - start > (DWORD)InterlockedCompareExchange(&watchdogMs, 0, 0)) ExitProcess(2);
    Sleep(20);
  }
}
static DWORD WINAPI controlThread(LPVOID unused) {
  char byte; DWORD count;
  (void)unused;
  ReadFile(GetStdHandle(STD_INPUT_HANDLE), &byte, 1, &count, NULL);
  SetEvent(controlEvent);
  return 0;
}
static int exact(void *buffer, DWORD length) {
  DWORD count, available; char *p = (char *)buffer;
  ULONGLONG deadline = GetTickCount64() + 5000;
  while (length) {
    if (GetTickCount64() >= deadline || !PeekNamedPipe(GetStdHandle(STD_INPUT_HANDLE), NULL, 0, NULL, &available, NULL)) return 0;
    if (!available) { Sleep(10); continue; }
    if (!ReadFile(GetStdHandle(STD_INPUT_HANDLE), p, length < available ? length : available, &count, NULL) || !count) return 0;
    p += count; length -= count;
  }
  return 1;
}
static void report(const char *outcome, const char *reason, int root, int settled) {
  printf("{\"version\":1,\"outcome\":\"%s\",\"reason\":\"%s\",\"rootExited\":%s,\"managedSettled\":%s,\"descendantsReaped\":%s}\n",
    outcome, reason, root ? "true" : "false", settled ? "true" : "false", settled ? "true" : "false");
  fflush(stdout);
}
int wmain(int argc, wchar_t **argv) {
  DWORD h[9], total = 0, i, active = 1, count, available, outputBytes = 0;
  wchar_t *parts[4] = {0};
  HANDLE job = NULL, completion = NULL, outRead = NULL, outWrite = NULL, nullInput = INVALID_HANDLE_VALUE;
  SECURITY_ATTRIBUTES sa = {sizeof(sa), NULL, TRUE};
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = {0};
  JOBOBJECT_ASSOCIATE_COMPLETION_PORT association = {0};
  JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting;
  STARTUPINFOEXW si = {0}; PROCESS_INFORMATION pi = {0}; SIZE_T attributeBytes = 0;
  HANDLE inherited[2]; ULONGLONG start, stopping = 0;
  const char *reason = "exit"; int root = 0, settled = 0, result = 1;
  int rejectAssignment = argc == 2 && wcscmp(argv[1], L"--assignment-failure") == 0;
  { HANDLE watchdog = CreateThread(NULL, 0, watchdogThread, NULL, 0, NULL);
    if (!watchdog) return 2;
    CloseHandle(watchdog);
  }
  if (argc > 1 && !rejectAssignment) goto done;
  if (!exact(h, sizeof(h)) || h[0] != 1 || h[8] != 0 || h[1] < 1 || h[1] > 60000 || h[2] < 1 || h[2] > 10000 || h[3] < 1 || h[3] > 1048576) goto done;
  for (i = 0; i < 4; i++) {
    if (h[4+i] < 2 || h[4+i] > 60000 || (h[4+i] & 1)) goto done;
    total += h[4+i]; if (total > 65500) goto done;
    parts[i] = (wchar_t *)calloc(1, h[4+i]);
    if (!parts[i] || !exact(parts[i], h[4+i]) || parts[i][h[4+i]/2-1] != 0) goto done;
    if (i < 3 && wcslen(parts[i]) != h[4+i]/2-1) goto done;
  }
  if (h[7] < 4 || parts[3][h[7]/2-2] != 0 || wcslen(parts[0]) < 3 || parts[0][1] != L':' || parts[0][2] != L'\\' || wcslen(parts[2]) < 3 || parts[2][1] != L':' || parts[2][2] != L'\\') goto done;
  InterlockedExchange(&watchdogMs, (LONG)(h[1] + h[2] + 6000));
  job = CreateJobObjectW(NULL, NULL);
  if (!job) goto done;
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) goto done;
  completion = CreateIoCompletionPort(INVALID_HANDLE_VALUE, NULL, 0, 1);
  association.CompletionKey = job; association.CompletionPort = completion;
  if (!completion || !SetInformationJobObject(job, JobObjectAssociateCompletionPortInformation, &association, sizeof(association))) goto done;
  if (!CreatePipe(&outRead, &outWrite, &sa, 0) || !SetHandleInformation(outRead, HANDLE_FLAG_INHERIT, 0)) goto done;
  nullInput = CreateFileW(L"NUL", GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, &sa, OPEN_EXISTING, 0, NULL);
  if (nullInput == INVALID_HANDLE_VALUE) goto done;
  InitializeProcThreadAttributeList(NULL, 1, 0, &attributeBytes);
  si.lpAttributeList = (LPPROC_THREAD_ATTRIBUTE_LIST)malloc(attributeBytes);
  if (!si.lpAttributeList) goto done;
  if (!InitializeProcThreadAttributeList(si.lpAttributeList, 1, 0, &attributeBytes)) { free(si.lpAttributeList); si.lpAttributeList = NULL; goto done; }
  inherited[0] = outWrite; inherited[1] = nullInput;
  if (!UpdateProcThreadAttribute(si.lpAttributeList, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, inherited, sizeof(inherited), NULL, NULL)) goto done;
  si.StartupInfo.cb = sizeof(si); si.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
  si.StartupInfo.hStdInput = nullInput; si.StartupInfo.hStdOutput = outWrite; si.StartupInfo.hStdError = outWrite;
  if (!CreateProcessW(parts[0], parts[1], NULL, NULL, TRUE, CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT, parts[3], parts[2], &si.StartupInfo, &pi)) goto done;
  /* Controlled native fault: closed Job makes the actual assignment API fail.
   * Target stays suspended and is terminated, so fixture cannot write witness. */
  if (rejectAssignment) { CloseHandle(job); job = NULL; }
  if (!AssignProcessToJobObject(job, pi.hProcess)) goto done;
  controlEvent = CreateEventW(NULL, TRUE, FALSE, NULL);
  if (!controlEvent) goto done;
  { HANDLE thread = CreateThread(NULL, 0, controlThread, NULL, 0, NULL);
    if (!thread) goto done;
    CloseHandle(thread);
  }
  if (ResumeThread(pi.hThread) == (DWORD)-1) goto done;
  CloseHandle(outWrite); outWrite = NULL;
  start = GetTickCount64();
  for (;;) {
    char buffer[1024]; DWORD message; ULONG_PTR key; LPOVERLAPPED overlap;
    GetQueuedCompletionStatus(completion, &message, &key, &overlap, 10);
    root = WaitForSingleObject(pi.hProcess, 0) == WAIT_OBJECT_0;
    if (QueryInformationJobObject(job, JobObjectBasicAccountingInformation, &accounting, sizeof(accounting), NULL)) active = accounting.ActiveProcesses;
    else { reason = "termination-unconfirmed"; break; }
    available = 0;
    if (PeekNamedPipe(outRead, NULL, 0, NULL, &available, NULL) && available) {
      if (ReadFile(outRead, buffer, available > (DWORD)sizeof(buffer) ? (DWORD)sizeof(buffer) : available, &count, NULL)) {
        if (count > h[3] - outputBytes) { reason = "output-limit"; }
        else {
          outputBytes += count;
          printf("{\"outputHex\":\""); for (i = 0; i < count; i++) printf("%02x", (unsigned int)(unsigned char)buffer[i]); printf("\"}\n"); fflush(stdout);
        }
      }
    }
    if (!active && !available) { settled = 1; break; }
    if (!stopping) {
      if (WaitForSingleObject(controlEvent, 0) == WAIT_OBJECT_0) reason = "cancelled";
      else if (GetTickCount64() - start >= h[1]) reason = "timeout";
      if (strcmp(reason, "exit") != 0) { stopping = GetTickCount64(); TerminateJobObject(job, 1); }
    }
    if (stopping && GetTickCount64() - stopping >= h[2]) { reason = "termination-unconfirmed"; break; }
  }
  report(settled ? (strcmp(reason, "exit") == 0 ? "complete" : "failed") : "uncertain", reason, root, settled);
  result = settled ? 0 : 2;
  goto cleanup;
done:
  if (pi.hProcess) { TerminateProcess(pi.hProcess, 1); settled = WaitForSingleObject(pi.hProcess, 5000) == WAIT_OBJECT_0; }
  else settled = 1;
  report(settled ? "failed" : "uncertain", settled ? "launch-failed" : "termination-unconfirmed", pi.hProcess != NULL && settled, settled);
cleanup:
  if (job) CloseHandle(job);
  if (pi.hThread) CloseHandle(pi.hThread);
  if (pi.hProcess) CloseHandle(pi.hProcess);
  if (outRead) CloseHandle(outRead);
  if (outWrite) CloseHandle(outWrite);
  if (nullInput != INVALID_HANDLE_VALUE) CloseHandle(nullInput);
  if (completion) CloseHandle(completion);
  if (si.lpAttributeList) { DeleteProcThreadAttributeList(si.lpAttributeList); free(si.lpAttributeList); }
  for (i = 0; i < 4; i++) free(parts[i]);
  /* Process exit ends the blocked control reader; do not close its live event. */
  return result;
}
