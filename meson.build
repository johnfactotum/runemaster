project('io.github.johnfactotum.Runemaster',
    version: '1.0.0',
    meson_version: '>=0.59'
)

gnome = import('gnome')

prefix = get_option('prefix')
bindir = prefix / get_option('bindir')
datadir = prefix / get_option('datadir')

desktopdir = datadir / 'applications'
iconsdir = datadir / 'icons'
metainfodir = datadir / 'metainfo'
schemadir = datadir / 'glib-2.0' / 'schemas'

gjs = dependency('gjs-1.0', version: '>= 1.76')
dependency('gtk4', version: '>= 4.16')
dependency('libadwaita-1', version: '>= 1.7')

bin_conf = configuration_data()
bin_conf.set('GJS', gjs.get_variable(pkgconfig: 'gjs_console'))
bin_conf.set('datadir', join_paths(get_option('prefix'), get_option('datadir')))

configure_file(
    configuration: bin_conf,
    input: 'runemaster.js',
    install_dir: bindir,
    install_mode: 'rwxr-xr-x',
    output: 'runemaster'
)

install_data('io.github.johnfactotum.Runemaster.desktop',
    install_dir: desktopdir
)

install_data('io.github.johnfactotum.Runemaster.metainfo.xml',
    install_dir: metainfodir
)

install_data('io.github.johnfactotum.Runemaster.svg',
    install_dir: iconsdir / 'hicolor' / 'scalable' / 'apps'
)

install_data('io.github.johnfactotum.Runemaster.gschema.xml',
    install_dir: schemadir
)

pkgdatadir = join_paths(get_option('datadir'), meson.project_name())

gnome.compile_resources(
    meson.project_name(),
    'gresource.xml',
    gresource_bundle: true,
    install: true,
    install_dir: pkgdatadir,
)

gnome.post_install(
    glib_compile_schemas: true,
    gtk_update_icon_cache: true,
    update_desktop_database: true,
)
