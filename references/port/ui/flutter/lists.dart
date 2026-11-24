// DualCraft UI idioms — Flutter lists.
import 'package:flutter/material.dart';

class Item {
  const Item(this.id, this.title);
  final String id;
  final String title;
}

// @idiom lazy-list — Long list built lazily, with stable keys and item tap
class ItemList extends StatelessWidget {
  const ItemList({super.key, required this.items, required this.onTap});
  final List<Item> items;
  final void Function(Item) onTap;
  @override
  Widget build(BuildContext context) => ListView.separated(
        itemCount: items.length,
        separatorBuilder: (context, index) => const Divider(height: 1),
        itemBuilder: (context, i) => ListTile(key: ValueKey(items[i].id), title: Text(items[i].title), onTap: () => onTap(items[i])),
      );
}

// @idiom pull-refresh — Pull to refresh
class RefreshableList extends StatelessWidget {
  const RefreshableList({super.key, required this.items, required this.onRefresh});
  final List<Item> items;
  final Future<void> Function() onRefresh;
  @override
  Widget build(BuildContext context) => RefreshIndicator(onRefresh: onRefresh, child: ItemList(items: items, onTap: (_) {}));
}

// @idiom grid — Adaptive grid
class ItemGrid extends StatelessWidget {
  const ItemGrid({super.key, required this.items});
  final List<Item> items;
  @override
  Widget build(BuildContext context) => GridView.builder(
        gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(maxCrossAxisExtent: 160, mainAxisSpacing: 8, crossAxisSpacing: 8),
        itemCount: items.length,
        itemBuilder: (context, i) => Card(child: Center(child: Text(items[i].title))),
      );
}
