// Excluded, independently implemented test transport. Real console + original
// process handle; no Pi/controller substitutions, Job, or descendant guarantee.
// Microsoft contracts: creating-a-pseudoconsole-session, CreateProcessW,
// STARTUPINFOEXW, ClosePseudoConsole, WaitForSingleObject, CancelSynchronousIo,
// PeekNamedPipe, GetHandleInformation and SetHandleInformation.
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;

namespace Cadence.TerminalFixture
{
    public sealed class Config
    {
        public string Root { get; set; }
        public string Cwd { get; set; }
        public string[] Argv { get; set; }
        public Dictionary<string, string> Env { get; set; }
        public Step[] Steps { get; set; }
        // Smoke-only read chunking; the wire event and aggregate 512-byte bound
        // are unchanged. Production uses the default 513-byte overflow probe.
        public int? ControlReadSize { get; set; }
        // Excluded smoke gates/injections only, never production readiness.
        public bool SmokePrerequisite { get; set; }
        public bool SmokeBufferedControl { get; set; }
        public bool SmokeAwaitControlFault { get; set; }
        public string SmokeLateControl { get; set; }
        public string SmokePumpFault { get; set; }
    }
    public sealed class Step
    {
        public string Expect { get; set; }
        public string Event { get; set; }
        public int[] Resize { get; set; }
        public string[] Send { get; set; }
    }
    internal static class Native
    {
        [StructLayout(LayoutKind.Sequential)]
        internal struct Coord { internal short X, Y; }
        [StructLayout(LayoutKind.Sequential)]
        internal struct StartupInfo
        {
            internal uint cb;
            internal IntPtr reserved, desktop, title;
            internal uint x, y, width, height, columns, rows, fill, flags;
            internal ushort show, reservedBytes;
            internal IntPtr reservedData, stdin, stdout, stderr;
        }
        [StructLayout(LayoutKind.Sequential)]
        internal struct StartupInfoEx
        {
            internal StartupInfo StartupInfo;
            internal IntPtr attributes;
        }
        [StructLayout(LayoutKind.Sequential)]
        internal struct ProcessInfo
        {
            internal IntPtr process, thread;
            internal uint pid, tid;
        }
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool CreatePipe(out IntPtr read, out IntPtr write, IntPtr security, uint size);
        [DllImport("kernel32.dll", ExactSpelling = true)]
        internal static extern int CreatePseudoConsole(Coord size, IntPtr input, IntPtr output, uint flags, out IntPtr console);
        [DllImport("kernel32.dll", ExactSpelling = true)]
        internal static extern int ResizePseudoConsole(IntPtr console, Coord size);
        [DllImport("kernel32.dll", ExactSpelling = true)]
        internal static extern void ClosePseudoConsole(IntPtr console);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref UIntPtr size);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, UIntPtr attribute, IntPtr value, UIntPtr size, IntPtr previous, IntPtr returned);
        [DllImport("kernel32.dll")]
        internal static extern void DeleteProcThreadAttributeList(IntPtr list);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool CreateProcessW(string application, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity,
            [MarshalAs(UnmanagedType.Bool)] bool inherit, uint flags, IntPtr environment, string cwd, ref StartupInfoEx startup, out ProcessInfo process);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool ReadFile(IntPtr handle, [Out] byte[] bytes, uint count, out uint read, IntPtr overlapped);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool WriteFile(IntPtr handle, byte[] bytes, uint count, out uint written, IntPtr overlapped);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool PeekNamedPipe(IntPtr pipe, IntPtr buffer, uint size, IntPtr read, out uint available, IntPtr left);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool GetHandleInformation(IntPtr handle, out uint flags);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool GetExitCodeProcess(IntPtr process, out uint code);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool TerminateProcess(IntPtr process, uint code);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool CloseHandle(IntPtr handle);
        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern IntPtr GetStdHandle(int kind);
        [DllImport("kernel32.dll")]
        internal static extern uint GetCurrentThreadId();
        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern IntPtr OpenThread(uint access, [MarshalAs(UnmanagedType.Bool)] bool inherit, uint id);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool CancelSynchronousIo(IntPtr thread);
    }
    internal sealed class FixtureFailure : Exception
    {
        internal FixtureFailure(string code) : base(code) { }
    }
    internal sealed class Pump
    {
        internal Thread Worker;
        internal string Kind;
        internal IntPtr Handle;
        internal volatile bool Stopping;
        // All lifecycle/handle/diagnostic fields are projected under Fixture.gate.
        internal bool StartAttempted, Started, Entered, ReadyObserved, Joined, CancelRequested;
        internal object FirstIoFault, LastIoError;
        internal ManualResetEventSlim Release = new ManualResetEventSlim();
        internal int? CancelError;
        internal ManualResetEventSlim Ready = new ManualResetEventSlim();
    }
    internal sealed class Input
    {
        internal byte[] Bytes;
        internal bool Written;
        internal ManualResetEventSlim Done = new ManualResetEventSlim();
    }
    public sealed class Fixture
    {
        // A NEW fixture transcript bound, not the product's protocol cap.
        // Overflow fails and continues draining; never truncated into a pass.
        private const int TranscriptBound = 4 * 1024 * 1024;
        private const uint StartfUseStdHandles = 0x00000100;
        private readonly object gate = new object();
        private readonly Stopwatch clock = Stopwatch.StartNew();
        private readonly double setupMs;
        private readonly MemoryStream raw = new MemoryStream();
        private readonly List<byte> eventBuffer = new List<byte>();
        private readonly List<object> observations = new List<object>();
        private readonly List<object> escapes = new List<object>();
        private readonly List<object> resizes = new List<object>();
        private readonly List<object> nativeCalls = new List<object>();
        private readonly List<object> resourceCloses = new List<object>();
        private readonly List<object> inheritance = new List<object>();
        private readonly BlockingCollection<Input> inputs = new BlockingCollection<Input>(1);
        private readonly List<Pump> pumps = new List<Pump>();
        private readonly Regex ansi = new Regex(@"\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~]|[()][0-2A-Z]|.)", RegexOptions.None, TimeSpan.FromSeconds(1));
        private Config config;
        private IntPtr inputRead, inputWrite, outputRead, outputWrite, hpc, attributes, environment;
        private Native.ProcessInfo child;
        private bool attributesInitialized, closeCalled, forced, nativeWaitReturned, waitBeforeClose, quitObserved;
        private volatile bool closeReturned, outputEof;
        private Pump outputPump, controlPump;
        private IntPtr controlHandle;
        private bool controlCutoffRequested, controlCutoffReached, controlParkRequested, controlParked;
        private uint? controlCutoffAvailable, lateQueuedAvailable;
        private int? lateQueuedError;
        private int controlCutoffReads;
        private bool smokePrerequisiteReached, closeWorkerStarted, closeWorkerJoined;
        private object firstNativeFault, firstWaitFailure, firstExitFailure;
        private bool? createProcessInheritHandles;
        private string smokePumpInjection;
        private uint? nativeWaitResult, exitCode;
        private int? nativeWaitError, exitCodeError;
        private int eventBytes, controlReads;
        private int? waitStep;
        private bool hasEvent, consumed, escapeAfterReady;
        private bool? receivedBeforeWait;
        private long outputBytes;
        private string failure, failureStage, teardownFailure;
        private string stage = "configuration";
        private string pwsh;
        private double Now { get { return setupMs + clock.Elapsed.TotalMilliseconds; } }
        private Fixture(double setup, string version) { setupMs = setup; pwsh = version; }
        private void Fail(string code)
        {
            lock (gate) { if (failure == null) { failure = code; failureStage = stage; } Monitor.PulseAll(gate); }
        }
        private static void Require(bool ok, string code) { if (!ok) throw new FixtureFailure(code); }
        private void Check()
        {
            lock (gate)
            {
                if (failure != null) throw new FixtureFailure(failure);
                Require(Now < 90000, "scenario-deadline");
            }
        }
        private void TeardownFault(string code) { lock (gate) teardownFailure = teardownFailure ?? code; }
        private void Attempt(Action action, string code)
        {
            try { action(); } catch { TeardownFault(code); }
        }
        private void Close(ref IntPtr handle, string resource)
        {
            if (handle == IntPtr.Zero) return;
            bool ok = Native.CloseHandle(handle);
            int? error = ok ? (int?)null : Marshal.GetLastWin32Error();
            lock (gate)
            {
                resourceCloses.Add(new { resource, returned = ok, error });
                if (ok) handle = IntPtr.Zero;
                else
                {
                    firstNativeFault = firstNativeFault ?? new { api = "CloseHandle", error };
                    teardownFailure = teardownFailure ?? "close-handle-failed";
                }
            }
        }
        private void NativeRequire(bool ok, string api, string code, int? capturedError = null)
        {
            int? error = ok ? (int?)null : capturedError ?? Marshal.GetLastWin32Error();
            lock (gate)
            {
                var fact = new { api, returned = ok, error };
                nativeCalls.Add(fact);
                if (!ok) firstNativeFault = firstNativeFault ?? fact;
            }
            Require(ok, code);
        }
        private void IoError(Pump pump, string api, int? error, bool fault)
        {
            lock (gate)
            {
                var fact = new { api, error };
                pump.LastIoError = fact;
                if (fault) { pump.FirstIoFault = pump.FirstIoFault ?? fact; firstNativeFault = firstNativeFault ?? fact; }
            }
        }
        private void VerifyNoninherit(IntPtr handle, string resource)
        {
            uint flags;
            NativeRequire(Native.GetHandleInformation(handle, out flags), "GetHandleInformation", "handle-information-failed");
            lock (gate) inheritance.Add(new { resource, flags, inheritable = (flags & 1) != 0 });
            Require((flags & 1) == 0, "fixture-handle-inheritable");
        }
        // Standard Windows CRT quoting, NOT CMD-shell/verbatim quoting.
        public static string Quote(string value)
        {
            Require(value != null && !value.Contains('\0'), "argv-invalid");
            var text = new StringBuilder("\"");
            int slashes = 0;
            foreach (char c in value)
            {
                if (c == '\\') { slashes++; continue; }
                text.Append('\\', c == '"' ? slashes * 2 + 1 : slashes);
                text.Append(c); slashes = 0;
            }
            return text.Append('\\', slashes * 2).Append('"').ToString();
        }
        private void Setup()
        {
            Require(config != null && config.Argv != null && config.Argv.Length > 0 && config.Env != null
                && config.Steps != null && config.Steps.Length <= 128, "config-invalid");
            Require(!config.ControlReadSize.HasValue || (config.ControlReadSize.Value > 0 && config.ControlReadSize.Value <= 513), "control-read-size-invalid");
            Require(Path.IsPathFullyQualified(config.Root), "config-root-invalid");
            Require(Path.IsPathFullyQualified(config.Argv[0]) && Path.IsPathFullyQualified(config.Cwd), "config-path-invalid");
            Require(Marshal.SizeOf<Native.Coord>() == 4 && Marshal.SizeOf<Native.StartupInfo>() == (IntPtr.Size == 8 ? 104 : 68)
                && Marshal.SizeOf<Native.StartupInfoEx>() == (IntPtr.Size == 8 ? 112 : 72)
                && Marshal.SizeOf<Native.ProcessInfo>() == (IntPtr.Size == 8 ? 24 : 16), "native-layout-invalid");
            var env = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var pair in config.Env)
            {
                Require(!String.IsNullOrEmpty(pair.Key) && !pair.Key.Contains('=') && !pair.Key.Contains('\0') && pair.Value != null && !pair.Value.Contains('\0') && !env.ContainsKey(pair.Key), "environment-invalid");
                env.Add(pair.Key, pair.Value);
            }
            string block = String.Join("\0", env.Select(pair => pair.Key + "=" + pair.Value)) + "\0\0";
            environment = Marshal.StringToHGlobalUni(block);
            var command = new StringBuilder(String.Join(" ", config.Argv.Select(Quote)));
            Require(command.Length < 32767, "argv-overflow");
            lock (gate) stage = "native-setup";
            Require(config.SmokeLateControl == null || (config.SmokePrerequisite &&
                (config.SmokeLateControl == "bytes" || config.SmokeLateControl == "eof")), "smoke-late-config-invalid");
            Require(config.SmokePumpFault == null || new[] { "start-input", "ready-input", "late-input" }.Contains(config.SmokePumpFault), "smoke-pump-config-invalid");
            smokePumpInjection = config.SmokePumpFault; // only the validated fixed enum
            controlHandle = Native.GetStdHandle(-10);
            NativeRequire(Native.SetHandleInformation(controlHandle, 1, 0), "SetHandleInformation", "control-inheritance-clear-failed");
            VerifyNoninherit(controlHandle, "helper-control");
            // NULL security: every pipe end is non-inheritable.
            CreatePipe(out inputRead, out inputWrite, "input-pipe-failed");
            CreatePipe(out outputRead, out outputWrite, "output-pipe-failed");
            VerifyNoninherit(inputRead, "input-read"); VerifyNoninherit(inputWrite, "input-write");
            VerifyNoninherit(outputRead, "output-read"); VerifyNoninherit(outputWrite, "output-write");
            IntPtr created;
            int hr = Native.CreatePseudoConsole(new Native.Coord { X = 120, Y = 48 }, inputRead, outputWrite, 0, out created);
            lock (gate)
            {
                var fact = new { api = "CreatePseudoConsole", hresult = hr };
                nativeCalls.Add(fact); if (hr != 0) firstNativeFault = firstNativeFault ?? fact;
            }
            hpc = hr == 0 ? created : IntPtr.Zero;
            Require(hr == 0, "create-pseudoconsole-failed");
            outputPump = StartPump("output", OutputPump);
            UIntPtr size = UIntPtr.Zero;
            bool sized = Native.InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size); // expected sizing failure
            int? sizingError = sized ? (int?)null : Marshal.GetLastWin32Error();
            lock (gate) nativeCalls.Add(new { api = "InitializeProcThreadAttributeList-size", returned = sized,
                error = sizingError, bytes = size.ToUInt64() });
            Require(size.ToUInt64() > 0 && size.ToUInt64() <= 65536, "attribute-size-invalid");
            attributes = Marshal.AllocHGlobal(checked((int)size.ToUInt64()));
            NativeRequire(Native.InitializeProcThreadAttributeList(attributes, 1, 0, ref size), "InitializeProcThreadAttributeList", "attribute-init-failed");
            attributesInitialized = true;
            // Microsoft walkthrough passes the HPCON VALUE, not &HPCON.
            NativeRequire(Native.UpdateProcThreadAttribute(attributes, 0, new UIntPtr(0x00020016), hpc, new UIntPtr((uint)IntPtr.Size), IntPtr.Zero, IntPtr.Zero), "UpdateProcThreadAttribute", "attribute-update-failed");
            var startup = new Native.StartupInfoEx();
            startup.StartupInfo.cb = (uint)Marshal.SizeOf<Native.StartupInfoEx>();
            startup.attributes = attributes;
            // Candidate policy from Microsoft's actual ConptyConnection launcher:
            // flag set, three zero-initialized NULL std handles, inherit=false.
            // Never redirect helper/control pipes into the client's stdio. Native
            // creation alone does NOT prove the child's CRT fd/TTY mapping.
            startup.StartupInfo.flags = StartfUseStdHandles;
            Native.ProcessInfo process;
            lock (gate) createProcessInheritHandles = false;
            bool launched = Native.CreateProcessW(config.Argv[0], command, IntPtr.Zero, IntPtr.Zero, false,
                0x00080000 | 0x00000400, environment, config.Cwd, ref startup, out process);
            NativeRequire(launched, "CreateProcessW", "create-process-failed");
            child = process; // never close unestablished out handles on failure
            Close(ref child.thread, "child-thread");
            Close(ref inputRead, "input-read"); Close(ref outputWrite, "output-write");
            StartPump("input", InputPump);
            if (config.SmokePrerequisite)
            {
                lock (gate) stage = "smoke-prerequisite";
                WaitStep(new Step { Expect = "CONSOLE_READY 中文 🧪" }, 0, -1);
                int cursor; lock (gate) cursor = (int)raw.Length;
                SendKey("CONSOLE_PROBE 中文 🧪\r");
                WaitStep(new Step { Expect = "CONSOLE_INPUT_ISOLATED" }, cursor, -1);
                lock (gate) smokePrerequisiteReached = true;
                Console.Out.WriteLine("conpty-smoke-prerequisite"); Console.Out.Flush();
            }
            // Buffered/split parser bytes may precede this gate, but native fault
            // publishing waits for it. Early means before the EVENT barrier wait,
            // not before the child has proved console/input prerequisites.
            lock (gate) stage = config.SmokePrerequisite ? "smoke-control-validation" : "interaction";
            StartPump("control", ControlPump);
            if (config.SmokeAwaitControlFault)
            {
                Require(config.SmokePrerequisite, "smoke-fault-gate-config-invalid");
                double deadline = Math.Min(Now + 15000, 90000);
                lock (gate)
                {
                    // Separate parser-negative scheduling: native gate already
                    // reached; do not advance inputs until the actual fault.
                    while (failure == null) { Require(Now < deadline, "smoke-control-fault-deadline"); Monitor.Wait(gate, 10); }
                    Check();
                }
            }
            if (config.SmokeBufferedControl)
            {
                Require(config.SmokePrerequisite, "smoke-buffered-config-invalid");
                double deadline = Math.Min(Now + 15000, 90000);
                lock (gate)
                {
                    while (!hasEvent) { Check(); Require(Now < deadline, "smoke-buffered-event-deadline"); Monitor.Wait(gate, 10); }
                }
            }
            lock (gate) stage = "interaction";
        }
        private void CreatePipe(out IntPtr read, out IntPtr write, string code)
        {
            IntPtr r, w;
            bool ok = Native.CreatePipe(out r, out w, IntPtr.Zero, 0);
            // Win32 documents failed CreatePipe out parameters as indeterminate.
            read = ok ? r : IntPtr.Zero; write = ok ? w : IntPtr.Zero;
            NativeRequire(ok, "CreatePipe", code);
        }
        private Pump StartPump(string kind, Action<Pump> action)
        {
            var pump = new Pump { Kind = kind };
            lock (gate)
            {
                pumps.Add(pump);
                if (kind == "output") outputPump = pump;
                if (kind == "control") controlPump = pump;
            }
            pump.Worker = new Thread(() => {
                try
                {
                    lock (gate) pump.Entered = true;
                    // Deterministic fixture scheduling injections, NOT OS failures.
                    if (config.SmokePumpFault == "late-" + kind) pump.Release.Wait();
                    IntPtr handle = Native.OpenThread(0x0001, false, Native.GetCurrentThreadId());
                    int? handleError = handle == IntPtr.Zero ? (int?)Marshal.GetLastWin32Error() : null;
                    lock (gate) pump.Handle = handle;
                    NativeRequire(handle != IntPtr.Zero, "OpenThread", "pump-thread-handle-failed", handleError);
                    if (config.SmokePumpFault == "ready-" + kind) pump.Release.Wait();
                    lock (gate)
                    {
                        if (pump.Stopping) return;
                        pump.ReadyObserved = true;
                    }
                    pump.Ready.Set();
                    action(pump);
                }
                catch (FixtureFailure error) { Fail(error.Message); }
                catch { Fail("pump-failed"); }
                finally { pump.Ready.Set(); lock (gate) Monitor.PulseAll(gate); }
            });
            pump.Worker.IsBackground = true;
            Require(config.SmokePumpFault != "start-" + kind, "injected-pump-start-failed");
            lock (gate) pump.StartAttempted = true;
            try { pump.Worker.Start(); lock (gate) pump.Started = true; }
            catch
            {
                // Preserve even an unusual ambiguous Start failure rather than
                // assuming no worker can still run or own a thread handle.
                lock (gate) pump.Started = (pump.Worker.ThreadState & System.Threading.ThreadState.Unstarted) == 0;
                throw new FixtureFailure("pump-start-failed");
            }
            Require(pump.Ready.Wait(1000), "pump-start-deadline");
            Check();
            lock (gate) Require(pump.ReadyObserved, "pump-not-ready");
            return pump;
        }
        private void OutputPump(Pump pump)
        {
            var bytes = new byte[65536];
            while (!pump.Stopping)
            {
                uint read;
                if (!Native.ReadFile(outputRead, bytes, (uint)bytes.Length, out read, IntPtr.Zero))
                {
                    int error = Marshal.GetLastWin32Error();
                    bool canceled = pump.Stopping && error == 995;
                    IoError(pump, "ReadFile", error, error != 109 && !canceled);
                    if (error == 109) { lock (gate) outputEof = true; return; }
                    if (canceled) return;
                    throw new FixtureFailure("terminal-read-failed");
                }
                // A successful zero-byte pipe read can be a null write, not EOF.
                if (read == 0) continue;
                lock (gate)
                {
                    outputBytes += read;
                    if (outputBytes > TranscriptBound) Fail("terminal-output-overflow");
                    else raw.Write(bytes, 0, (int)read);
                    Monitor.PulseAll(gate);
                }
            }
        }
        private void ControlPump(Pump pump)
        {
            // One reader only. Peek works on anonymous pipes; read at most its
            // available count. Native I/O is outside gate (a synchronous Peek may
            // block): a missed bounded join retains uncertainty, never a pass.
            var bytes = new byte[config.ControlReadSize ?? 513];
            while (true)
            {
                bool cutoffRound;
                lock (gate)
                {
                    while (controlParkRequested && !controlCutoffRequested && !pump.Stopping)
                    {
                        controlParked = true; Monitor.PulseAll(gate); Monitor.Wait(gate, 10);
                    }
                    if (pump.Stopping) return;
                    cutoffRound = controlCutoffRequested;
                }
                uint available;
                bool peeked = Native.PeekNamedPipe(controlHandle, IntPtr.Zero, 0, IntPtr.Zero, out available, IntPtr.Zero);
                if (!peeked)
                {
                    int error = Marshal.GetLastWin32Error();
                    bool canceled = pump.Stopping && error == 995;
                    IoError(pump, "PeekNamedPipe", error, !canceled);
                    if (canceled) return;
                    throw new FixtureFailure(error == 109 ? "control-event-eof" : "control-pipe-peek-failed");
                }
                if (available == 0)
                {
                    lock (gate)
                    {
                        if (cutoffRound)
                        {
                            Require(eventBuffer.Count == 0, "control-event-trailing-bytes");
                            controlCutoffAvailable = 0; controlCutoffReached = true;
                            Monitor.PulseAll(gate); return;
                        }
                        Monitor.Wait(gate, 10);
                    }
                    continue;
                }
                uint read;
                bool ok = Native.ReadFile(controlHandle, bytes, Math.Min((uint)bytes.Length, available), out read, IntPtr.Zero);
                if (!ok)
                {
                    int error = Marshal.GetLastWin32Error();
                    bool canceled = pump.Stopping && error == 995;
                    IoError(pump, "ReadFile", error, !canceled);
                    if (canceled) return;
                    throw new FixtureFailure(error == 109 ? "control-event-eof" : "control-pipe-read-failed");
                }
                Require(read != 0, "control-pipe-zero-read");
                // A successful read is ALWAYS parsed, including one in flight
                // when cutoff/cancellation was requested. No fault is erased.
                lock (gate)
                {
                    if (cutoffRound) controlCutoffReads++;
                    controlReads++;
                    eventBytes += (int)read;
                    Require(eventBytes <= 512, "control-event-overflow");
                    eventBuffer.AddRange(bytes.Take((int)read));
                    int newline;
                    while ((newline = eventBuffer.IndexOf(10)) >= 0)
                    {
                        Require(!hasEvent, "control-event-duplicate");
                        byte[] line = eventBuffer.Take(newline).ToArray();
                        eventBuffer.RemoveRange(0, newline + 1);
                        JsonDocument json;
                        try { json = JsonDocument.Parse(new UTF8Encoding(false, true).GetString(line)); }
                        catch { throw new FixtureFailure("control-event-invalid"); }
                        using (json)
                        {
                            var e = json.RootElement;
                            Require(e.ValueKind == JsonValueKind.Object, "control-event-unexpected");
                            var properties = e.EnumerateObject().ToArray();
                            Require(properties.Length == 3 && properties.Select(p => p.Name).Distinct().Count() == 3
                                && properties.All(p => p.Name == "event" || p.Name == "requestOrdinal" || p.Name == "editingOrdinal"), "control-event-unexpected");
                            JsonElement name = e.GetProperty("event"), request = e.GetProperty("requestOrdinal"), editing = e.GetProperty("editingOrdinal");
                            int r, c;
                            Require(name.ValueKind == JsonValueKind.String && name.GetString() == "cancellation-http-pending"
                                && request.ValueKind == JsonValueKind.Number && request.TryGetInt32(out r) && r == 4
                                && editing.ValueKind == JsonValueKind.Number && editing.TryGetInt32(out c) && c == 3, "control-event-unexpected");
                        }
                        hasEvent = true; receivedBeforeWait = waitStep == null;
                    }
                    Require(!hasEvent || eventBuffer.Count == 0, "control-event-trailing-bytes");
                    Monitor.PulseAll(gate);
                }
            }
        }
        private void InputPump(Pump pump)
        {
            foreach (var input in inputs.GetConsumingEnumerable())
            {
                if (pump.Stopping) return;
                try
                {
                    uint written;
                    bool ok = Native.WriteFile(inputWrite, input.Bytes, (uint)input.Bytes.Length, out written, IntPtr.Zero);
                    int? error = ok ? (int?)null : Marshal.GetLastWin32Error();
                    bool canceled = pump.Stopping && error == 995;
                    if (!ok || written != input.Bytes.Length) IoError(pump, "WriteFile", error, !canceled);
                    input.Written = ok && written == input.Bytes.Length;
                    if (!canceled) Require(input.Written, "terminal-write-failed");
                }
                finally { input.Done.Set(); }
            }
        }
        private bool WaitChild(uint milliseconds = 0)
        {
            if (child.process == IntPtr.Zero) return false;
            if (!nativeWaitReturned)
            {
                uint result = Native.WaitForSingleObject(child.process, milliseconds);
                int? error = result == 0 || result == 258 ? (int?)null : Marshal.GetLastWin32Error();
                lock (gate)
                {
                    nativeWaitResult = result; nativeWaitError = error;
                    if (result != 0 && result != 258)
                    {
                        var fact = new { api = "WaitForSingleObject", result, error };
                        firstWaitFailure = firstWaitFailure ?? fact; firstNativeFault = firstNativeFault ?? fact;
                    }
                    if (result == 0) { nativeWaitReturned = true; waitBeforeClose = !closeCalled; }
                }
                Require(result == 0 || result == 258, "native-wait-failed");
                if (result != 0) return false;
            }
            if (exitCode.HasValue) return true;
            uint code;
            bool gotCode = Native.GetExitCodeProcess(child.process, out code);
            int? exitError = gotCode ? (int?)null : Marshal.GetLastWin32Error();
            lock (gate)
            {
                exitCodeError = exitError;
                if (gotCode) exitCode = code;
                else
                {
                    var fact = new { api = "GetExitCodeProcess", error = exitError };
                    firstExitFailure = firstExitFailure ?? fact; firstNativeFault = firstNativeFault ?? fact;
                }
            }
            Require(gotCode, "native-exit-code-failed");
            return true;
        }
        private void WaitStep(Step step, int cursor, int index)
        {
            double deadline = Math.Min(Now + 15000, 90000);
            bool matched = step.Expect == null;
            var pattern = matched ? null : new Regex(step.Expect, RegexOptions.None, TimeSpan.FromSeconds(1));
            lock (gate)
            {
                if (step.Event != null)
                {
                    Require(step.Event == "cancellation-http-pending" && waitStep == null, "control-event-invalid-wait");
                    waitStep = index;
                }
                while (Now < deadline)
                {
                    Check();
                    Require(!WaitChild(), "child-exited-before-expected-terminal-or-event");
                    if (!matched)
                    {
                        byte[] bytes = raw.ToArray();
                        // Fresh bytes since the preceding input ONLY. No old
                        // accumulated heading and no synthetic screen projection.
                        string text = ansi.Replace(Encoding.UTF8.GetString(bytes, cursor, bytes.Length - cursor), "");
                        if (pattern.IsMatch(text))
                        {
                            observations.Add(new { pattern = step.Expect, matched = true, rawStart = cursor, rawEnd = bytes.Length });
                            matched = true;
                        }
                    }
                    if (matched && (step.Event == null || hasEvent))
                    {
                        if (step.Event != null) consumed = true;
                        return;
                    }
                    Monitor.Wait(gate, Math.Max(1, (int)Math.Min(40, deadline - Now)));
                }
            }
            throw new FixtureFailure(step.Event != null ? "terminal-event-step-deadline" : "terminal-step-deadline");
        }
        private void SendKey(string key)
        {
            double sent = Now;
            var input = new Input { Bytes = new UTF8Encoding(false, true).GetBytes(key) };
            Require(inputs.TryAdd(input), "terminal-input-queue-full");
            while (!input.Done.Wait(10)) { Check(); Require(Now < sent + 15000, "terminal-write-deadline"); }
            lock (gate) { Check(); Require(input.Written, "terminal-write-failed"); if (key == "\x1b") escapeAfterReady = consumed; }
            int delay = key == "\x1b" ? 100 : 40;
            while (Now < sent + delay) { lock (gate) { Check(); Monitor.Wait(gate, Math.Max(1, (int)Math.Min(40, sent + delay - Now))); } }
            if (key == "\x1b") lock (gate) escapes.Add(new { inputHex = "1b", minimumDelayMs = 100, elapsedMs = Now - sent });
        }
        private void ParkLateControl()
        {
            double deadline = Math.Min(Now + 15000, 90000);
            lock (gate)
            {
                controlParkRequested = true; Monitor.PulseAll(gate);
                while (!controlParked) { Check(); Require(Now < deadline, "smoke-control-park-deadline"); Monitor.Wait(gate, 10); }
            }
            Console.Out.WriteLine("conpty-control-parked"); Console.Out.Flush();
            // The producer enqueues only AFTER this owned signal. Prove bytes or
            // broken-pipe are present while the sole reader is parked, then quit.
            while (Now < deadline)
            {
                Check(); uint available;
                bool ok = Native.PeekNamedPipe(controlHandle, IntPtr.Zero, 0, IntPtr.Zero, out available, IntPtr.Zero);
                int? error = ok ? (int?)null : Marshal.GetLastWin32Error();
                if ((config.SmokeLateControl == "bytes" && ok && available > 0) ||
                    (config.SmokeLateControl == "eof" && !ok && error == 109))
                {
                    lock (gate) { lateQueuedAvailable = ok ? (uint?)available : null; lateQueuedError = error; }
                    return;
                }
                Require(ok, "smoke-control-queue-probe-failed");
                lock (gate) Monitor.Wait(gate, 10);
            }
            throw new FixtureFailure("smoke-control-queue-deadline");
        }
        private void Interact()
        {
            int cursor = 0;
            for (int index = 0; index < config.Steps.Length; index++)
            {
                Step step = config.Steps[index];
                if (step.Expect != null || step.Event != null) WaitStep(step, cursor, index);
                if (step.Resize != null)
                {
                    Require(step.Resize.Length == 2 && step.Resize.All(n => n > 0 && n <= Int16.MaxValue), "resize-invalid");
                    int hr = Native.ResizePseudoConsole(hpc, new Native.Coord { X = (short)step.Resize[1], Y = (short)step.Resize[0] });
                    lock (gate)
                    {
                        resizes.Add(new { rows = step.Resize[0], columns = step.Resize[1], hresult = hr });
                        if (hr != 0) firstNativeFault = firstNativeFault ?? new { api = "ResizePseudoConsole", hresult = hr };
                    }
                    Require(hr == 0, "resize-pseudoconsole-failed");
                }
                if (step.Send == null) continue;
                lock (gate) { Check(); cursor = (int)raw.Length; }
                if (config.SmokeLateControl != null && index == config.Steps.Length - 1) ParkLateControl();
                foreach (string key in step.Send) SendKey(key);
            }
            lock (gate) { Check(); Require(consumed, "control-event-not-consumed"); }
            lock (gate) stage = "quit-wait";
            double quitDeadline = Math.Min(Now + 15000, 90000);
            while (Now < quitDeadline)
            {
                lock (gate) { Check(); if (WaitChild()) break; Monitor.Wait(gate, 40); }
            }
            Require(nativeWaitReturned, "child-did-not-exit-after-quit");
            Require(exitCode == 0 && waitBeforeClose && !forced, "child-quit-nonzero-or-forced");
            lock (gate) quitObserved = true; // original handle signaled + exit0 BEFORE teardown
        }
        private void StopPump(Pump pump)
        {
            bool started;
            lock (gate) { started = pump.Started; }
            if (!started) return; // No Join on an unstarted Thread.
            if (pump == controlPump)
            {
                lock (gate) { controlCutoffRequested = true; Monitor.PulseAll(gate); }
                if (!pump.Worker.Join(1000)) TeardownFault("control-cutoff-unconfirmed");
                lock (gate)
                {
                    // On an earlier parser failure the worker may have exited;
                    // joined is not a claim that its protocol reached cutoff.
                    if (!controlCutoffReached && failure == null) teardownFailure = teardownFailure ?? "control-cutoff-unconfirmed";
                }
            }
            lock (gate) { pump.Stopping = true; Monitor.PulseAll(gate); }
            pump.Release.Set();
            double deadline = Now + 1000;
            while (!pump.Worker.Join(10) && Now < deadline)
            {
                IntPtr handle; lock (gate) { handle = pump.Handle; pump.CancelRequested = handle != IntPtr.Zero; }
                if (handle == IntPtr.Zero) continue;
                if (!Native.CancelSynchronousIo(handle))
                {
                    int error = Marshal.GetLastWin32Error();
                    if (error != 1168) lock (gate) pump.CancelError = error;
                }
            }
            lock (gate)
            {
                pump.Joined = !pump.Worker.IsAlive;
                if (pump.Joined) Close(ref pump.Handle, pump.Kind + "-thread");
                else teardownFailure = teardownFailure ?? "io-stop-unconfirmed";
            }
        }
        private bool Settled(Pump pump) { lock (gate) return !pump.Started || pump.Joined; }
        private void Teardown()
        {
            lock (gate) stage = "teardown";
            // Each resource has an independent bounded attempt. A wait/API/start
            // failure cannot suppress the remaining teardown observations.
            bool exited = false;
            Attempt(() => { exited = WaitChild(); }, "native-pre-stop-wait-failed");
            if (child.process != IntPtr.Zero && !exited)
            {
                lock (gate) forced = true;
                Attempt(() => {
                    bool stopped = Native.TerminateProcess(child.process, 1);
                    int? error = stopped ? (int?)null : Marshal.GetLastWin32Error();
                    lock (gate)
                    {
                        var fact = new { api = "TerminateProcess", returned = stopped, error };
                        nativeCalls.Add(fact); if (!stopped) firstNativeFault = firstNativeFault ?? fact;
                    }
                    if (!stopped) TeardownFault("terminate-process-failed");
                }, "terminate-process-failed");
                Attempt(() => { if (!WaitChild(3000)) TeardownFault("native-stop-unconfirmed"); }, "native-stop-wait-failed");
            }
            Attempt(() => inputs.CompleteAdding(), "input-queue-stop-failed");
            foreach (var pump in pumps.Where(p => p != outputPump).ToArray())
                Attempt(() => StopPump(pump), "pump-stop-failed");
            Attempt(() => Close(ref inputRead, "input-read"), "input-read-close-failed");
            Attempt(() => Close(ref outputWrite, "output-write"), "output-write-close-failed");
            Attempt(() => {
                if (attributesInitialized) { Native.DeleteProcThreadAttributeList(attributes); lock (gate) attributesInitialized = false; }
            }, "attribute-delete-failed");
            // Do not free an attribute list whose delete was unconfirmed.
            if (!attributesInitialized) Attempt(() => {
                if (attributes != IntPtr.Zero) { Marshal.FreeHGlobal(attributes); lock (gate) attributes = IntPtr.Zero; }
            }, "attribute-free-failed");
            Attempt(() => {
                if (environment != IntPtr.Zero) { Marshal.FreeHGlobal(environment); lock (gate) environment = IntPtr.Zero; }
            }, "environment-free-failed");
            if (hpc != IntPtr.Zero && !attributesInitialized)
            {
                Attempt(() => {
                    IntPtr closing = hpc;
                    // Called means the API was actually entered, not merely
                    // scheduled. Preserve start/join separately.
                    var close = new Thread(() => {
                        lock (gate) closeCalled = true;
                        try { Native.ClosePseudoConsole(closing); lock (gate) closeReturned = true; }
                        catch { TeardownFault("pseudoconsole-close-failed"); }
                    });
                    close.IsBackground = true; close.Start();
                    lock (gate) closeWorkerStarted = true;
                    bool joined = close.Join(3000);
                    lock (gate) closeWorkerJoined = joined;
                    if (!joined) TeardownFault("pseudoconsole-close-unconfirmed");
                    else if (!closeReturned) TeardownFault("pseudoconsole-close-failed");
                    if (joined && closeReturned) lock (gate) hpc = IntPtr.Zero;
                }, "pseudoconsole-close-start-failed");
            }
            if (outputPump != null)
            {
                Attempt(() => {
                    if (closeWorkerJoined && closeReturned)
                    {
                        if (!outputPump.Started || !outputPump.Worker.Join(3000) || !outputEof)
                            TeardownFault("terminal-drain-unconfirmed");
                        StopPump(outputPump);
                    }
                    else if (!closeWorkerStarted && hpc == IntPtr.Zero) StopPump(outputPump);
                    else if (outputPump.Started && !outputPump.Worker.IsAlive)
                    {
                        lock (gate) { outputPump.Joined = true; Close(ref outputPump.Handle, "output-thread"); }
                    }
                    // A started/unjoined close may still enter/use HPCON: retain
                    // reader/pipe/HPCON even if closeCalled snapshot is false.
                }, "output-stop-failed");
            }
            bool consoleSettled = hpc == IntPtr.Zero && (!closeWorkerStarted || (closeWorkerJoined && closeReturned));
            if (pumps.Where(p => p.Kind == "input").All(Settled) && consoleSettled)
                Attempt(() => Close(ref inputWrite, "input-write"), "input-write-close-failed");
            if ((outputPump == null || Settled(outputPump)) && consoleSettled)
                Attempt(() => Close(ref outputRead, "output-read"), "output-read-close-failed");
            Attempt(() => Close(ref child.thread, "child-thread"), "child-thread-close-failed");
            Attempt(() => Close(ref child.process, "child-process"), "child-process-close-failed");
        }
        public static int Run(string file, double setup, string pwshVersion)
        {
            var fixture = new Fixture(setup, pwshVersion);
            try
            {
                Require(new FileInfo(file).Length <= 128 * 1024, "config-overflow");
                fixture.config = JsonSerializer.Deserialize<Config>(File.ReadAllText(file, new UTF8Encoding(false, true)), new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                fixture.Setup(); fixture.Interact();
            }
            catch (FixtureFailure error) { fixture.Fail(error.Message); }
            catch { fixture.Fail("fixture-failed"); }
            finally
            {
                try { fixture.Teardown(); } catch { fixture.TeardownFault("teardown-failed"); }
                lock (fixture.gate)
                {
                    // Fixed whitelist: no config/env/argv, auth, HTTP bodies or prompts.
                    var receipt = new {
                        transport = "windows-conpty", pid = fixture.child.pid,
                        nativeWaitReturned = fixture.nativeWaitReturned, nativeWaitResult = fixture.nativeWaitResult,
                        nativeWaitError = fixture.nativeWaitError, exitCodeError = fixture.exitCodeError,
                        firstNativeFault = fixture.firstNativeFault, firstWaitFailure = fixture.firstWaitFailure,
                        firstExitFailure = fixture.firstExitFailure,
                        exitCode = fixture.exitCode, waitBeforeClose = fixture.waitBeforeClose,
                        quitObservedBeforeTeardown = fixture.quitObserved,
                        cleanQuit = fixture.quitObserved && fixture.controlCutoffReached && fixture.failure == null && fixture.teardownFailure == null, forced = fixture.forced,
                        closePseudoConsoleCalled = fixture.closeCalled, closePseudoConsoleReturned = fixture.closeReturned,
                        teardownFailure = fixture.teardownFailure, failure = fixture.failure, failureStage = fixture.failureStage,
                        outputEof = fixture.outputEof, nativeCalls = fixture.nativeCalls.ToArray(), resourceCloses = fixture.resourceCloses.ToArray(),
                        handleInheritance = fixture.inheritance.ToArray(), createProcessInheritHandles = fixture.createProcessInheritHandles,
                        configuredStartupPolicy = new { strategy = "startf-usestdhandles-null-conpty",
                            flags = StartfUseStdHandles, stdinNull = true, stdoutNull = true, stderrNull = true },
                        smokePrerequisiteReached = fixture.smokePrerequisiteReached,
                        smokePumpInjection = fixture.smokePumpInjection,
                        closeWorkerStarted = fixture.closeWorkerStarted, closeWorkerJoined = fixture.closeWorkerJoined,
                        controlCutoff = new { requested = fixture.controlCutoffRequested, reached = fixture.controlCutoffReached,
                            available = fixture.controlCutoffAvailable, reads = fixture.controlCutoffReads,
                            boundary = "first-quiet-native-snapshot-after-request", futureInputValidated = false },
                        lateControl = new { parked = fixture.controlParked, queuedAvailable = fixture.lateQueuedAvailable, queuedError = fixture.lateQueuedError },
                        pumps = fixture.pumps.Select(p => new { kind = p.Kind, startAttempted = p.StartAttempted,
                            started = p.Started, entered = p.Entered, ready = p.ReadyObserved, joined = p.Joined,
                            handleRetained = p.Handle != IntPtr.Zero, firstIoFault = p.FirstIoFault, lastIoError = p.LastIoError,
                            cancelRequested = p.CancelRequested, cancelError = p.CancelError }).ToArray(),
                        diagnosticSnapshotMayAdvance = fixture.pumps.Any(p => p.Started && !p.Joined)
                            || (fixture.closeWorkerStarted && !fixture.closeWorkerJoined),
                        resourcesRetained = fixture.hpc != IntPtr.Zero || fixture.inputRead != IntPtr.Zero || fixture.inputWrite != IntPtr.Zero
                            || fixture.outputRead != IntPtr.Zero || fixture.outputWrite != IntPtr.Zero || fixture.child.process != IntPtr.Zero
                            || fixture.child.thread != IntPtr.Zero || fixture.attributes != IntPtr.Zero || fixture.environment != IntPtr.Zero
                            || fixture.pumps.Any(p => p.Handle != IntPtr.Zero || (p.Started && !p.Joined))
                            || (fixture.closeWorkerStarted && !fixture.closeWorkerJoined),
                        observations = fixture.observations.ToArray(), resizeCalls = fixture.resizes.ToArray(), escapeKeys = fixture.escapes.ToArray(),
                        seconds = fixture.Now / 1000, setupMs = setup, outputBytes = fixture.outputBytes, transcriptBound = TranscriptBound,
                        barrier = new { @event = fixture.hasEvent ? new { @event = "cancellation-http-pending", requestOrdinal = 4, editingOrdinal = 3 } : null,
                            receivedBeforeWait = fixture.receivedBeforeWait, waitStep = fixture.waitStep,
                            consumed = fixture.consumed, escapeAfterReady = fixture.escapeAfterReady, bytes = fixture.eventBytes,
                            reads = fixture.controlReads, readSize = fixture.config == null ? (int?)null : fixture.config.ControlReadSize ?? 513 },
                        pwsh = fixture.pwsh, dotnet = Environment.Version.ToString(), windows = Environment.OSVersion.VersionString,
                        physicalHuman = false, paidProvider = false, nativeExecutor = false
                    };
                    try
                    {
                        File.WriteAllBytes(Path.Combine(fixture.config.Root, "terminal.bin"), fixture.raw.ToArray());
                        string json = JsonSerializer.Serialize(receipt, new JsonSerializerOptions { WriteIndented = true });
                        Require(Encoding.UTF8.GetByteCount(json) <= 64 * 1024, "receipt-overflow");
                        File.WriteAllText(Path.Combine(fixture.config.Root, "pty-receipt.json"), json, new UTF8Encoding(false));
                    }
                    catch { Console.Error.WriteLine("conpty-diagnostics-unavailable"); fixture.Fail("diagnostics-unavailable"); }
                }
            }
            lock (fixture.gate) return fixture.failure == null && fixture.teardownFailure == null && fixture.quitObserved && fixture.controlCutoffReached ? 0 : 1;
        }
    }
}
