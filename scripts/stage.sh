#!/bin/sh
# Lay out the installed file tree of luci-theme-7dollar in $1 (shared by build-ipk.sh and build-apk.sh).
set -eu
cd "$(dirname "$0")/.."
D=$1
mkdir -p "$D/www" "$D/usr/share/ucode/luci"
cp -R htdocs/. "$D/www/"
cp -R ucode/. "$D/usr/share/ucode/luci/"
cp -R root/. "$D/"
find "$D" -name .DS_Store -exec rm {} +
find "$D" -type d -exec chmod 755 {} +
find "$D" -type f -exec chmod 644 {} +
chmod 755 "$D"/etc/uci-defaults/*
