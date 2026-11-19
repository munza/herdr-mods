// Builds and installs only Branch Issue. Doesn't edit layouts or key bindings.
// From the mod's folder: go -C helper run ./install [--update]
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"slices"
	"strings"
)

const (
	mod    = "branch-issue"
	title  = "Branch Issue"
	binary = "herdr-linear"
)

// Stand-ins for tests.
var (
	lookPath           = exec.LookPath
	out      io.Writer = os.Stdout
	run                = func(dir string, env []string, args ...string) error {
		cmd := exec.Command(args[0], args[1:]...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(), env...)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		return cmd.Run()
	}
)

// root is the mod's folder in this repo, wherever the command was run from.
func root() string {
	_, file, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(file), "..", "..")
}

func readManifest(folder string) (map[string]any, error) {
	b, err := os.ReadFile(filepath.Join(folder, "mod.json"))
	if err != nil {
		return nil, err
	}
	var manifest map[string]any
	return manifest, json.Unmarshal(b, &manifest)
}

// keepSettings writes a person's settings into the new manifest and returns the
// keys the new version no longer has. A value back at its default is left out,
// since settings hold only what the person changed.
// shortcut: the rewritten mod.json has its keys sorted, which only matters to someone reading it.
func keepSettings(path string, kept map[string]any) ([]string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var fresh map[string]any
	if err := json.Unmarshal(b, &fresh); err != nil {
		return nil, err
	}
	settings, _ := fresh["settings"].(map[string]any)
	if settings == nil {
		settings = map[string]any{}
	}
	dropped := merge(settings, knownSettings(filepath.Dir(path), settings), kept, "")
	slices.Sort(dropped)
	if len(settings) > 0 {
		fresh["settings"] = settings
	}
	written, err := json.MarshalIndent(fresh, "", "  ")
	if err != nil {
		return nil, err
	}
	return dropped, os.WriteFile(path, append(written, '\n'), 0o644)
}

// knownSettings is every setting the new version takes, nested, with its default:
// from its mod.schema.json, else the settings its mod.json ships.
func knownSettings(dir string, shipped map[string]any) map[string]any {
	var schema struct {
		Properties struct {
			Settings any `json:"settings"`
		} `json:"properties"`
	}
	if b, err := os.ReadFile(filepath.Join(dir, "mod.schema.json")); err == nil && json.Unmarshal(b, &schema) == nil {
		if known, ok := defaults(schema.Properties.Settings).(map[string]any); ok {
			return known
		}
	}
	return shipped
}

// defaults turns a schema node into its default, or an object of its properties' defaults.
func defaults(node any) any {
	n, _ := node.(map[string]any)
	properties, ok := n["properties"].(map[string]any)
	if !ok {
		return n["default"]
	}
	out := map[string]any{}
	for key, value := range properties {
		out[key] = defaults(value)
	}
	return out
}

// merge writes the given values that known has into settings, and names the rest.
func merge(settings, known, given map[string]any, path string) []string {
	dropped := []string{}
	for key, value := range given {
		name := path + key
		current, isKnown := known[key]
		if !isKnown {
			dropped = append(dropped, name)
			continue
		}
		knownInner, isMap := current.(map[string]any)
		givenInner, givenMap := value.(map[string]any)
		if isMap && givenMap {
			inner, _ := settings[key].(map[string]any)
			if inner == nil {
				inner = map[string]any{}
			}
			dropped = append(dropped, merge(inner, knownInner, givenInner, name+".")...)
			if len(inner) > 0 {
				settings[key] = inner
			} else {
				delete(settings, key)
			}
		} else if reflect.DeepEqual(value, current) {
			delete(settings, key)
		} else {
			settings[key] = value
		}
	}
	return dropped
}

func copyTree(from, to string) error {
	return filepath.WalkDir(from, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(from, path)
		if err != nil {
			return err
		}
		destination := filepath.Join(to, relative)
		if entry.IsDir() {
			return os.MkdirAll(destination, 0o755)
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		return os.WriteFile(destination, b, info.Mode().Perm())
	})
}

func copyFile(from, to string) error {
	b, err := os.ReadFile(from)
	if err != nil {
		return err
	}
	return os.WriteFile(to, b, 0o755)
}

// target is the system the helper is built for: this one, unless the app that runs it is
// elsewhere, as when Herdr runs on Windows and this command in WSL.
type target struct{ goos, goarch string }

var native = target{runtime.GOOS, runtime.GOARCH}

func (t target) cross() bool { return t != native }

// helperName is what the mod calls, with the .exe Windows looks for.
func (t target) helperName() string {
	if t.goos == "windows" {
		return binary + ".exe"
	}
	return binary
}

func install(appHome string, update bool, to target) error {
	target := filepath.Join(appHome, "mods", mod)
	shipped, err := readManifest(filepath.Join(root(), "mods", mod))
	if err != nil {
		return err
	}
	var installed map[string]any
	info, err := os.Lstat(target)
	if err == nil && info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("refusing to overwrite a symlink: %s", target)
	}
	if err == nil {
		found, readErr := readManifest(target)
		if !update || readErr != nil || found["title"] != title {
			return fmt.Errorf("%s already exists; use --update only for an existing %s install", target, title)
		}
		installed = found
	}
	// herdr-app checks the install where it can run; built for elsewhere, it's run there.
	tools := []string{"go", "herdr-app"}
	if to.cross() {
		tools = tools[:1]
	}
	for _, program := range tools {
		if _, err := lookPath(program); err != nil {
			return fmt.Errorf("%s is required (Go 1.23+ builds the helper)", program)
		}
	}
	// There are no third-party Go dependencies. Build before touching the install.
	build, err := os.MkdirTemp("", mod+"-build-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(build)
	built := filepath.Join(build, to.helperName())
	env := []string{"GOOS=" + to.goos, "GOARCH=" + to.goarch}
	if err := run(filepath.Join(root(), "helper"), env, "go", "build", "-o", built, "."); err != nil {
		return err
	}
	if err := copyTree(filepath.Join(root(), "mods", mod), target); err != nil {
		return err
	}
	if kept, _ := installed["settings"].(map[string]any); kept != nil {
		dropped, err := keepSettings(filepath.Join(target, "mod.json"), kept)
		if err != nil {
			return err
		}
		if len(dropped) > 0 {
			fmt.Fprintln(out, "Settings no longer used and dropped: "+strings.Join(dropped, ", "))
		}
	}
	bin := filepath.Join(target, "bin")
	if err := os.MkdirAll(bin, 0o755); err != nil {
		return err
	}
	// A new file, not a rewrite: macOS kills a signed binary changed in place.
	fresh := filepath.Join(bin, "."+to.helperName()+".new")
	if err := copyFile(built, fresh); err != nil {
		return err
	}
	if err := os.Rename(fresh, filepath.Join(bin, to.helperName())); err != nil {
		return err
	}
	if to.cross() {
		fmt.Fprintf(out, "Built for %s/%s; run herdr-app check on that machine to check the install.\n", to.goos, to.goarch)
	} else if err := run("", nil, "herdr-app", "check", target); err != nil {
		return err
	}
	change := ""
	if update {
		previous := "unversioned"
		if v, ok := installed["version"].(string); ok {
			previous = v
		}
		change = " (was " + previous + ")"
	}
	fmt.Fprintf(out, "Installed %s %v%s: %s\n", title, shipped["version"], change, target)
	fmt.Fprintln(out, `Add {"mod":"branch-issue"} to a layout you own. No layout or keys were changed.`)
	return nil
}

func main() {
	home, err := os.UserHomeDir()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fallback := os.Getenv("HERDR_APP_HOME")
	if fallback == "" {
		fallback = filepath.Join(home, ".config/herdr-app")
	}
	appHome := flag.String("app-home", fallback, "Herdr's config folder")
	update := flag.Bool("update", false, "Update an existing "+title+" installation")
	goos := flag.String("goos", runtime.GOOS, "System the app that runs the helper is on, such as windows when installing from WSL")
	goarch := flag.String("goarch", runtime.GOARCH, "Its processor, such as amd64 or arm64")
	flag.Parse()
	if err := install(*appHome, *update, target{*goos, *goarch}); err != nil {
		var exit *exec.ExitError
		if !errors.As(err, &exit) {
			fmt.Fprintln(os.Stderr, err)
		}
		fmt.Fprintln(os.Stderr, title+" installation failed")
		os.Exit(1)
	}
}
