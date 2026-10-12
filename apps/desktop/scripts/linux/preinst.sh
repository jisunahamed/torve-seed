#!/bin/sh
set -eu

case "$1" in
    install|upgrade)
        previous_postrm=/var/lib/dpkg/info/torve-ai-vpn.postrm
        if [ -f "$previous_postrm" ]; then
            sed -i "s|update-alternatives --remove 'Torve VPR' '/usr/bin/Torve VPR'|rm -f '/usr/bin/Torve VPR'|" "$previous_postrm"
        fi
        ;;
esac
