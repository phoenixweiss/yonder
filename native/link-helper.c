// Isolated macOS helper. It creates exactly one symbolic link, only after an
// exact confirmation line. The destination parent is opened component by
// component without following symbolic links and remains anchored by its file
// descriptor across confirmation.
#ifndef __APPLE__
#error "This helper has only been validated for macOS"
#endif

#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <limits.h>
#include <signal.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static bool field(char *buffer, size_t capacity) {
  for (size_t i = 0; i < capacity; i++) {
    int value = getchar();
    if (value == EOF) return false;
    buffer[i] = (char)value;
    if (value == 0) return true;
  }
  return false;
}

static bool number(const char *text, uintmax_t *value) {
  if (*text == '\0') return false;
  *value = 0;
  for (; *text; text++) {
    if (*text < '0' || *text > '9') return false;
    unsigned digit = (unsigned)(*text - '0');
    if (*value > (UINTMAX_MAX - digit) / 10) return false;
    *value = *value * 10 + digit;
  }
  return true;
}

static bool component(const char *name, size_t length) {
  return length > 0 && length <= NAME_MAX &&
    !(length == 1 && name[0] == '.') &&
    !(length == 2 && name[0] == '.' && name[1] == '.');
}

static bool absolute_path(const char *path) {
  if (path[0] != '/' || path[1] == '\0') return false;
  const char *start = path + 1;
  for (const char *cursor = start; ; cursor++) {
    if (*cursor != '/' && *cursor != '\0') continue;
    if (!component(start, (size_t)(cursor - start))) return false;
    if (*cursor == '\0') return true;
    start = cursor + 1;
  }
}

static int open_directory(const char *path) {
  if (!absolute_path(path)) return -1;
  int flags = O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC;
  int directory = open("/", flags);
  if (directory < 0) return -1;
  const char *start = path + 1;
  while (*start) {
    const char *end = strchr(start, '/');
    size_t length = end ? (size_t)(end - start) : strlen(start);
    char name[NAME_MAX + 1];
    memcpy(name, start, length);
    name[length] = '\0';
    int next = openat(directory, name, flags);
    close(directory);
    if (next < 0) return -1;
    directory = next;
    if (!end) break;
    start = end + 1;
  }
  return directory;
}

static bool identity(int directory, uintmax_t device, uintmax_t inode) {
  struct stat info;
  return fstat(directory, &info) == 0 && S_ISDIR(info.st_mode) &&
    (uintmax_t)info.st_dev == device && (uintmax_t)info.st_ino == inode;
}

static bool same_path(const char *parent, uintmax_t device, uintmax_t inode) {
  int current = open_directory(parent);
  if (current < 0) return false;
  bool same = identity(current, device, inode);
  close(current);
  return same;
}

static bool emit(const char *status) {
  return printf("%s\n", status) >= 0 && fflush(stdout) == 0;
}

static int finish(int directory, const char *status) {
  if (directory >= 0) close(directory);
  bool sent = emit(status);
  return sent && strcmp(status, "created") == 0 ? 0 : 1;
}

int main(int argc, char **argv) {
  (void)argv;
  signal(SIGPIPE, SIG_IGN);
  char version[32], parent[PATH_MAX], source[PATH_MAX], name[NAME_MAX + 1];
  char device_text[32], inode_text[32];
  uintmax_t device, inode;
  if (argc != 1 ||
      !field(version, sizeof(version)) || strcmp(version, "yonder-link-v1") != 0 ||
      !field(parent, sizeof(parent)) || !field(device_text, sizeof(device_text)) ||
      !field(inode_text, sizeof(inode_text)) || !field(source, sizeof(source)) ||
      !field(name, sizeof(name)) || !number(device_text, &device) ||
      !number(inode_text, &inode) || !absolute_path(parent) || !absolute_path(source) ||
      !component(name, strlen(name)) || strchr(name, '/') != NULL) {
    return finish(-1, "rejected");
  }

  int directory = open_directory(parent);
  if (directory < 0 || !identity(directory, device, inode)) {
    return finish(directory, "rejected");
  }
  struct stat entry;
  if (fstatat(directory, name, &entry, AT_SYMLINK_NOFOLLOW) == 0) {
    return finish(directory, "occupied");
  }
  if (errno != ENOENT) return finish(directory, "rejected");
  if (!emit("ready")) {
    close(directory);
    return 1;
  }

  char confirmation[sizeof("confirm\n")];
  size_t length = fread(confirmation, 1, sizeof(confirmation), stdin);
  if (length == 0 && feof(stdin)) return finish(directory, "cancelled");
  if (length != sizeof("confirm\n") - 1 || !feof(stdin) || ferror(stdin) ||
      memcmp(confirmation, "confirm\n", length) != 0) {
    return finish(directory, "rejected");
  }

  if (symlinkat(source, directory, name) != 0) {
    int failure = errno;
    bool occupied = failure == EEXIST &&
      fstatat(directory, name, &entry, AT_SYMLINK_NOFOLLOW) == 0 &&
      same_path(parent, device, inode);
    return finish(directory, occupied ? "occupied" : "uncertain");
  }

  char actual[PATH_MAX];
  ssize_t size = readlinkat(directory, name, actual, sizeof(actual));
  bool verified = size >= 0 && (size_t)size == strlen(source) &&
    memcmp(actual, source, (size_t)size) == 0 &&
    fstatat(directory, name, &entry, AT_SYMLINK_NOFOLLOW) == 0 &&
    S_ISLNK(entry.st_mode) && same_path(parent, device, inode);
  return finish(directory, verified ? "created" : "uncertain");
}
