// DualCraft UI idioms — Flutter. Every "@idiom <id>" section has a counterpart with the same id in
// references/port/ui/{compose,swiftui,react-native}. Compiled in CI (flutter analyze): keep it valid.
import 'package:flutter/material.dart';

// @idiom screen-scaffold — Screen with top bar, body and main action
class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Perfil')),
        body: const SafeArea(child: ProfileHeader(name: 'Ana', avatarUrl: 'https://example.com/a.png')),
        floatingActionButton: FloatingActionButton(onPressed: () {}, tooltip: 'Añadir', child: const Icon(Icons.add)),
      );
}

// @idiom stack-layout — Column, Row, spacing, padding, weight, overlap
class ProfileHeader extends StatelessWidget {
  const ProfileHeader({super.key, required this.name, required this.avatarUrl});
  final String name;
  final String avatarUrl;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Stack(children: [
              CircleAvatar(radius: 32, backgroundImage: NetworkImage(avatarUrl)),
              const Positioned(right: 0, bottom: 0, child: Icon(Icons.verified, size: 16)),
            ]),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(name), const Text('Madrid')]),
            ),
          ],
        ),
      );
}

// @idiom text-image-button — Styled text, images and buttons
class ActionsPanel extends StatelessWidget {
  const ActionsPanel({super.key, required this.onSave});
  final VoidCallback onSave;
  @override
  Widget build(BuildContext context) => Column(children: [
        Text('Título', style: Theme.of(context).textTheme.titleLarge, maxLines: 1, overflow: TextOverflow.ellipsis),
        Image.network('https://example.com/cover.png', height: 120, fit: BoxFit.cover),
        FilledButton(onPressed: onSave, child: const Text('Guardar')),
        const OutlinedButton(onPressed: null, child: Text('Deshabilitado')),
        TextButton.icon(onPressed: onSave, icon: const Icon(Icons.share), label: const Text('Compartir')),
      ]);
}

// @idiom theme-tokens — Colours and typography from the theme (DualCraft tokens)
class LabelBadge extends StatelessWidget {
  const LabelBadge({super.key, required this.label});
  final String label;
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme; // DualCraft: context.ds (ThemeExtension) for custom tokens
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(color: scheme.primaryContainer, borderRadius: BorderRadius.circular(8)),
      child: Text(label, style: Theme.of(context).textTheme.labelMedium?.copyWith(color: scheme.onPrimaryContainer)),
    );
  }
}
