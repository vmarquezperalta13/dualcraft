// DualCraft UI idioms — Flutter state (Riverpod and Bloc).
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

// @idiom local-state — State owned by one widget
class CounterButton extends StatefulWidget {
  const CounterButton({super.key});
  @override
  State<CounterButton> createState() => _CounterButtonState();
}
class _CounterButtonState extends State<CounterButton> {
  int _count = 0;
  @override
  Widget build(BuildContext context) => TextButton(onPressed: () => setState(() => _count++), child: Text('$_count'));
}

// @idiom shared-state — Screen/app state outside the UI (Riverpod Notifier)
class CartState {
  const CartState({this.items = const [], this.busy = false});
  final List<String> items;
  final bool busy;
  CartState copyWith({List<String>? items, bool? busy}) => CartState(items: items ?? this.items, busy: busy ?? this.busy);
}
class CartNotifier extends Notifier<CartState> {
  @override
  CartState build() => const CartState();
  void add(String id) => state = state.copyWith(items: [...state.items, id]);
}
final cartProvider = NotifierProvider<CartNotifier, CartState>(CartNotifier.new);
class CartBadge extends ConsumerWidget {
  const CartBadge({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cart = ref.watch(cartProvider);
    return TextButton(onPressed: () => ref.read(cartProvider.notifier).add('x'), child: Text('${cart.items.length}'));
  }
}

// @idiom shared-state-bloc — The same with Bloc/Cubit (events → ViewModel methods)
class CartCubit extends Cubit<CartState> {
  CartCubit() : super(const CartState());
  void add(String id) => emit(state.copyWith(items: [...state.items, id]));
}
class CartBadgeBloc extends StatelessWidget {
  const CartBadgeBloc({super.key});
  @override
  Widget build(BuildContext context) => BlocBuilder<CartCubit, CartState>(
        builder: (context, cart) => TextButton(onPressed: () => context.read<CartCubit>().add('x'), child: Text('${cart.items.length}')),
      );
}

// @idiom async-state — Loading / data / error from an async source
final productsProvider = FutureProvider<List<String>>((ref) async {
  await Future<void>.delayed(const Duration(milliseconds: 10));
  return ['a', 'b'];
});
class ProductsView extends ConsumerWidget {
  const ProductsView({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) => ref.watch(productsProvider).when(
        data: (items) => Text('${items.length}'),
        loading: () => const CircularProgressIndicator(),
        error: (e, _) => Text('Error: $e'),
      );
}

// @idiom effects — Start work when shown, clean up when removed
class TickerText extends StatefulWidget {
  const TickerText({super.key});
  @override
  State<TickerText> createState() => _TickerTextState();
}
class _TickerTextState extends State<TickerText> {
  late final StreamSubscription<int> _sub;
  int _value = 0;
  @override
  void initState() {
    super.initState();
    _sub = Stream.periodic(const Duration(seconds: 1), (i) => i).listen((v) => setState(() => _value = v));
  }
  @override
  void dispose() {
    _sub.cancel();
    super.dispose();
  }
  @override
  Widget build(BuildContext context) => Text('$_value');
}
